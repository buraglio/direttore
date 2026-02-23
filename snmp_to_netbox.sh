#!/bin/sh

# snmp_to_netbox.sh
# ------------------------------------------------------------
# Walks a network device via SNMP and populates NetBox with:
#   interfaces (name + description), IPv4 addresses (with real prefix),
#   IPv6 addresses, serial number, VRFs, VLANs.
#
# Requirements:
#   * snmpwalk / snmpget  (net-snmp)
#   * curl, jq, python3
#
# Environment variables (required in .env or shell):
#   NETBOX_URL      – http://netbox.example.com
#   NETBOX_TOKEN    – NetBox API token with write access
#   SNMP_COMMUNITY  – SNMPv2c community (default: public)
#
# Usage:
#   ./snmp_to_netbox.sh [-s SITE] [-r ROLE] [-t TYPE] [-d] <IP_OR_HOST> <DEVICE_NAME>
#   ./snmp_to_netbox.sh [-s SITE] [-r ROLE] [-t TYPE] [-d] -f <CSV_FILE>
#
# Options:
#   -s SITE_NAME   Site name (create if absent)
#   -r ROLE_NAME   Device role (create if absent)
#   -t TYPE_NAME   Device type/model (create if absent)
#   -f CSV_FILE    Bulk CSV: IP,NAME[,SITE][,ROLE][,TYPE]
#   -d             Debug – print raw SNMP walk output and result counts
#
# IP/host input: literal IPv4, literal IPv6, DNS A/AAAA hostname.
# ------------------------------------------------------------

set -eu

SITE_NAME_GLOBAL=""
ROLE_NAME_GLOBAL=""
TYPE_NAME_GLOBAL=""
CSV_FILE=""
DEBUG=0

while getopts "s:r:t:f:dh" opt; do
  case "$opt" in
    s) SITE_NAME_GLOBAL="$OPTARG" ;;
    r) ROLE_NAME_GLOBAL="$OPTARG" ;;
    t) TYPE_NAME_GLOBAL="$OPTARG" ;;
    f) CSV_FILE="$OPTARG" ;;
    d) DEBUG=1 ;;
    h) echo "Usage: $0 [-s site] [-r role] [-t type] [-d] [-f csv] [<IP> <NAME>]"; exit 0 ;;
    *) echo "Usage: $0 [-s site] [-r role] [-t type] [-d] [-f csv] [<IP> <NAME>]"; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

DEVICE_IP="${1:-}"
DEVICE_NAME="${2:-}"

if [ -z "$CSV_FILE" ] && { [ -z "$DEVICE_IP" ] || [ -z "$DEVICE_NAME" ]; }; then
  echo "Usage: $0 [-s site] [-r role] [-t type] [-d] [-f csv] [<IP> <NAME>]"
  exit 1
fi

# Load .env if present
if [ -f ".env" ]; then
  set -a; . ./.env; set +a
fi

: "${NETBOX_URL:?NETBOX_URL required}"
: "${NETBOX_TOKEN:?NETBOX_TOKEN required}"
SNMP_COMMUNITY="${SNMP_COMMUNITY:-public}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

dbg() {
  [ "$DEBUG" -eq 1 ] && echo "[DEBUG] $*" >&2 || true
}

nb_api() {
  local method="$1" endpoint="$2" data="${3:-}"
  if [ -n "$data" ]; then
    curl -sS -X "$method" "${NETBOX_URL}/api/${endpoint}/" \
      -H "Authorization: Token $NETBOX_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$data"
  else
    curl -sS -X "$method" "${NETBOX_URL}/api/${endpoint}/" \
      -H "Authorization: Token $NETBOX_TOKEN" \
      -H "Content-Type: application/json"
  fi
}

# nb_get endpoint "param1=val1&param2=val2"
nb_get() {
  curl -sS "${NETBOX_URL}/api/${1}/?${2}" \
    -H "Authorization: Token $NETBOX_TOKEN" \
    -H "Content-Type: application/json"
}

nb_urlencode() { printf '%s' "$1" | jq -Rr @uri; }

# snmp_str line  →  strip "MIB::oid.n = STRING: " prefix and surrounding quotes
snmp_str() { echo "$1" | sed 's/.*STRING: //; s/^"//; s/"$//'; }

# mask_to_prefix dotted-decimal  →  prefix length integer
mask_to_prefix() {
  local mask="$1" prefix=0
  local IFS='.'
  for octet in $mask; do
    case "$octet" in
      255) prefix=$((prefix+8)) ;; 254) prefix=$((prefix+7)) ;;
      252) prefix=$((prefix+6)) ;; 248) prefix=$((prefix+5)) ;;
      240) prefix=$((prefix+4)) ;; 224) prefix=$((prefix+3)) ;;
      192) prefix=$((prefix+2)) ;; 128) prefix=$((prefix+1)) ;; 0) ;;
    esac
  done
  echo "$prefix"
}

# normalize_ipv6 raw  →  canonical compressed IPv6 (or empty on failure)
# Handles:
#   1. Byte-pair SNMP encoding:  fd:68:1e:02:dc:1a:00:05:00:00:00:00:00:00:00:03
#      (exactly 16 groups of 2 hex chars separated by colons)
#   2. Standard notation:        fd68:1e02:dc1a:5::3  fd68:1e02:dc1a:ffff::1  ::1
normalize_ipv6() {
  local raw="$1"
  if echo "$raw" | grep -qE '^([0-9a-fA-F]{2}:){15}[0-9a-fA-F]{2}$'; then
    python3 -c "
import ipaddress, sys
h = '$raw'.replace(':', '')
if len(h)!=32: sys.exit(1)
groups=[h[i:i+4] for i in range(0,32,4)]
print(str(ipaddress.ip_address(':'.join(groups))))
" 2>/dev/null || echo ""
  else
    python3 -c "import ipaddress; print(str(ipaddress.ip_address('$raw')))" 2>/dev/null || echo ""
  fi
}

# dec_bytes_to_ipv6  16 space-separated decimal bytes  →  compressed IPv6
# e.g. "253 104 30 2 220 26 0 5 0 0 0 0 0 0 0 3"  →  "fd68:1e02:dc1a:5::3"
dec_bytes_to_ipv6() {
  python3 -c "
import ipaddress, sys
parts = [int(x) for x in '$1'.split()]
if len(parts)!=16: sys.exit(1)
h=''.join('%02x'%b for b in parts)
groups=[h[i:i+4] for i in range(0,32,4)]
print(str(ipaddress.ip_address(':'.join(groups))))
" 2>/dev/null || echo ""
}

# snmpwalk_oid  →  walk by numeric OID, return output; debug shows raw result
snmpwalk_num() {
  local target="$1" oid="$2"
  local out
  out=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" -On "$target" "$oid" 2>/dev/null || true)
  dbg "snmpwalk -On $target $oid → $(echo "$out" | wc -l) lines"
  [ "$DEBUG" -eq 1 ] && echo "$out" | head -5 | sed 's/^/  [raw] /' >&2 || true
  echo "$out"
}

# ---------------------------------------------------------------------------
# process_device
# ---------------------------------------------------------------------------
process_device() {
  local DEVICE_IP="$1"
  local DEVICE_NAME="$2"
  local SITE_NAME="${3:-$SITE_NAME_GLOBAL}"
  local ROLE_NAME="${4:-$ROLE_NAME_GLOBAL}"
  local TYPE_NAME="${5:-$TYPE_NAME_GLOBAL}"

  # ---- SNMP transport target ------------------------------------------------
  local SNMP_TARGET="$DEVICE_IP"
  if echo "$DEVICE_IP" | grep -qE "^udp6?:"; then
    SNMP_TARGET="$DEVICE_IP"
  elif echo "$DEVICE_IP" | grep -q ":"; then
    SNMP_TARGET="udp6:[$DEVICE_IP]"
  elif echo "$DEVICE_IP" | grep -qE "^[0-9]{1,3}(\.[0-9]{1,3}){3}$"; then
    SNMP_TARGET="udp:$DEVICE_IP"
  else
    if snmpget -v2c -c "$SNMP_COMMUNITY" -t 2 -r 1 "udp:$DEVICE_IP" 1.3.6.1.2.1.1.1.0 >/dev/null 2>&1; then
      SNMP_TARGET="udp:$DEVICE_IP"
    elif snmpget -v2c -c "$SNMP_COMMUNITY" -t 2 -r 1 "udp6:$DEVICE_IP" 1.3.6.1.2.1.1.1.0 >/dev/null 2>&1; then
      SNMP_TARGET="udp6:$DEVICE_IP"
    fi
  fi

  echo ""
  echo "============================================================"
  echo "Processing Device: $DEVICE_NAME ($DEVICE_IP)"
  echo "SNMP target:       $SNMP_TARGET"
  echo "============================================================"

  # ---- 1. Device in NetBox --------------------------------------------------
  enc_dname=$(nb_urlencode "$DEVICE_NAME")
  DEVICE_ID=$(nb_get "dcim/devices" "name=${enc_dname}" \
    | jq -r '(.results // [])[] | select(.name == "'"$DEVICE_NAME"'") | .id' | head -n1)

  if [ -z "$DEVICE_ID" ]; then
    echo "Device $DEVICE_NAME not found – creating..."

    if [ -n "$SITE_NAME" ]; then
      SITE_ID=$(nb_get "dcim/sites" "name=$(nb_urlencode "$SITE_NAME")" | jq -r '.results[0].id // empty')
      if [ -z "$SITE_ID" ]; then
        echo "  Creating site $SITE_NAME..."
        slug=$(echo "$SITE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')
        SITE_ID=$(nb_api POST dcim/sites \
          "$(jq -n --arg n "$SITE_NAME" --arg s "$slug" '{name:$n,slug:$s,status:"active"}')" \
          | jq -r '.id // empty')
      fi
    else
      SITE_ID=$(nb_api GET "dcim/sites?limit=1" | jq -r '.results[0].id // empty')
    fi

    if [ -n "$ROLE_NAME" ]; then
      ROLE_ID=$(nb_get "dcim/device-roles" "name=$(nb_urlencode "$ROLE_NAME")" | jq -r '.results[0].id // empty')
      if [ -z "$ROLE_ID" ]; then
        echo "  Creating role $ROLE_NAME..."
        slug=$(echo "$ROLE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')
        ROLE_ID=$(nb_api POST dcim/device-roles \
          "$(jq -n --arg n "$ROLE_NAME" --arg s "$slug" '{name:$n,slug:$s,color:"9e9e9e"}')" \
          | jq -r '.id // empty')
      fi
    else
      ROLE_ID=$(nb_api GET "dcim/device-roles?limit=1" | jq -r '.results[0].id // empty')
    fi

    if [ -n "$TYPE_NAME" ]; then
      TYPE_ID=$(nb_get "dcim/device-types" "model=$(nb_urlencode "$TYPE_NAME")" | jq -r '.results[0].id // empty')
      if [ -z "$TYPE_ID" ]; then
        echo "  Creating device type $TYPE_NAME..."
        slug=$(echo "$TYPE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')
        MFG_ID=$(nb_get "dcim/manufacturers" "name=Generic" | jq -r '.results[0].id // empty')
        if [ -z "$MFG_ID" ]; then
          MFG_ID=$(nb_api POST dcim/manufacturers "$(jq -n '{name:"Generic",slug:"generic"}')" \
            | jq -r '.id // empty')
        fi
        TYPE_ID=$(nb_api POST dcim/device-types \
          "$(jq -n --arg m "$TYPE_NAME" --arg s "$slug" --arg mfg "$MFG_ID" \
             '{manufacturer:($mfg|tonumber),model:$m,slug:$s}')" \
          | jq -r '.id // empty')
      fi
    else
      TYPE_ID=$(nb_api GET "dcim/device-types?limit=1" | jq -r '.results[0].id // empty')
    fi

    if [ -z "${SITE_ID:-}" ] || [ -z "${ROLE_ID:-}" ] || [ -z "${TYPE_ID:-}" ]; then
      echo "ERROR: site/role/type missing – cannot create device."
      echo "  SITE='${SITE_ID:-}' ROLE='${ROLE_ID:-}' TYPE='${TYPE_ID:-}'"
      return 1
    fi

    resp=$(nb_api POST dcim/devices \
      "$(jq -n \
         --arg name "$DEVICE_NAME" \
         --arg site "$SITE_ID" \
         --arg role "$ROLE_ID" \
         --arg type "$TYPE_ID" \
         '{name:$name,status:"active",device_type:($type|tonumber),role:($role|tonumber),site:($site|tonumber)}')")
    DEVICE_ID=$(echo "$resp" | jq -r '.id // empty')
    if [ -z "$DEVICE_ID" ] || [ "$DEVICE_ID" = "null" ]; then
      echo "ERROR creating device:"; echo "$resp" | jq .; return 1
    fi
    echo "Created device $DEVICE_NAME (id=$DEVICE_ID)"
  else
    echo "Device $DEVICE_NAME exists (id=$DEVICE_ID)"
  fi

  # ---- 2. Interfaces --------------------------------------------------------
  # Walk ifDescr (1.3.6.1.2.1.2.2.1.2) and ifAlias (1.3.6.1.2.1.31.1.1.1.18)
  # using numeric OIDs so output is consistent regardless of MIB availability.
  echo "Walking interfaces..."

  ALIAS_FILE=$(mktemp)
  snmpwalk -On -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" 1.3.6.1.2.1.31.1.1.1.18 \
    2>/dev/null > "$ALIAS_FILE" || true
  alias_count=$(grep -c '= STRING:' "$ALIAS_FILE" || true)
  dbg "ifAlias: $alias_count entries"

  TMPFILE=$(mktemp)
  snmpwalk -On -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" 1.3.6.1.2.1.2.2.1.2 \
    2>/dev/null > "$TMPFILE" || true
  iface_count=$(grep -c '= STRING:' "$TMPFILE" || true)
  echo "  Found $iface_count interfaces via SNMP"

  if [ "$iface_count" -eq 0 ]; then
    echo "  Warning: no interfaces returned. Check community string and SNMP ACLs on the device."
  fi

  while IFS= read -r line; do
    # .1.3.6.1.2.1.2.2.1.2.4 = STRING: ether1
    if echo "$line" | grep -qE '\.1\.3\.6\.1\.2\.1\.2\.2\.1\.2\.([0-9]+) = STRING: .+'; then
      ifIndex=$(echo "$line" | sed 's/.*\.2\.2\.1\.2\.\([0-9]*\) .*/\1/')
      ifName=$(snmp_str "$line")
      [ -z "$ifName" ] && continue

      alias_line=$(grep -E "\.1\.3\.6\.1\.2\.1\.31\.1\.1\.1\.18\.${ifIndex} = " "$ALIAS_FILE" || true)
      ifAlias=$(snmp_str "$alias_line")

      if [ -n "$ifAlias" ]; then
        payload=$(jq -n \
          --arg name "$ifName" --argjson dev "$DEVICE_ID" --arg desc "$ifAlias" \
          '{name:$name,device:$dev,type:"other",description:$desc}')
      else
        payload=$(jq -n \
          --arg name "$ifName" --argjson dev "$DEVICE_ID" \
          '{name:$name,device:$dev,type:"other"}')
      fi

      enc_name=$(nb_urlencode "$ifName")
      iface_id=$(nb_get "dcim/interfaces" "device_id=${DEVICE_ID}&name=${enc_name}" \
        | jq -r '(.results // [])[] | select(.name == "'"$ifName"'") | .id' | head -n1)

      if [ -z "$iface_id" ]; then
        resp=$(nb_api POST dcim/interfaces "$payload")
        new_id=$(echo "$resp" | jq -r '.id // empty')
        if [ -n "$new_id" ] && [ "$new_id" != "null" ]; then
          [ -n "$ifAlias" ] \
            && echo "  Created $ifName (id=$new_id) desc=\"$ifAlias\"" \
            || echo "  Created $ifName (id=$new_id)"
        else
          echo "  ERROR creating $ifName: $(echo "$resp" | jq -c .)"
        fi
      else
        resp=$(nb_api PATCH "dcim/interfaces/$iface_id" "$payload")
        chk=$(echo "$resp" | jq -r '.id // empty')
        if [ -n "$chk" ] && [ "$chk" != "null" ]; then
          [ -n "$ifAlias" ] \
            && echo "  Updated $ifName (id=$iface_id) desc=\"$ifAlias\"" \
            || echo "  Updated $ifName (id=$iface_id)"
        else
          echo "  ERROR updating $ifName: $(echo "$resp" | jq -c .)"
        fi
      fi
    fi
  done < "$TMPFILE"
  rm -f "$TMPFILE" "$ALIAS_FILE"

  # ---- 3. IPv4 addresses ----------------------------------------------------
  # IP-MIB::ipAdEntAddr  1.3.6.1.2.1.4.20.1.1
  # IP-MIB::ipAdEntIfIndex 1.3.6.1.2.1.4.20.1.2
  # IP-MIB::ipAdEntNetMask 1.3.6.1.2.1.4.20.1.3
  echo "Walking IPv4 addresses..."
  TMPFILE=$(mktemp)
  snmpwalk -On -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" 1.3.6.1.2.1.4.20.1 \
    2>/dev/null > "$TMPFILE" || true
  ipv4_count=$(grep -cE '\.1\.3\.6\.1\.2\.1\.4\.20\.1\.1\.' "$TMPFILE" || true)
  echo "  Found $ipv4_count IPv4 address entries"

  if [ "$ipv4_count" -eq 0 ]; then
    echo "  Warning: no IPv4 addresses returned. Check community/ACL."
  fi

  while IFS= read -r line; do
    # .1.3.6.1.2.1.4.20.1.1.10.90.15.250 = IpAddress: 10.90.15.250
    if echo "$line" | grep -qE '\.1\.3\.6\.1\.2\.1\.4\.20\.1\.1\.[0-9.]+ = IpAddress: [0-9.]+'; then
      ip=$(echo "$line" | sed 's/.*IpAddress: //')

      # ifIndex: .1.3.6.1.2.1.4.20.1.2.<ip>
      idx_line=$(grep -E "\.1\.3\.6\.1\.2\.1\.4\.20\.1\.2\.${ip} " "$TMPFILE" || true)
      echo "$idx_line" | grep -qE 'INTEGER: [0-9]+' || continue
      ifIndex=$(echo "$idx_line" | sed 's/.*INTEGER: //')

      # Interface name via ifDescr numeric OID
      ifName=$(snmpget -On -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" \
        "1.3.6.1.2.1.2.2.1.2.${ifIndex}" 2>/dev/null \
        | sed 's/.*STRING: //; s/^"//; s/"$//')
      [ -z "$ifName" ] && continue

      # Subnet mask from same table: .1.3.6.1.2.1.4.20.1.3.<ip>
      mask_line=$(grep -E "\.1\.3\.6\.1\.2\.1\.4\.20\.1\.3\.${ip} " "$TMPFILE" || true)
      if echo "$mask_line" | grep -qE 'IpAddress: [0-9.]+'; then
        mask=$(echo "$mask_line" | sed 's/.*IpAddress: //')
        prefix=$(mask_to_prefix "$mask")
      else
        prefix=32
      fi
      cidr="${ip}/${prefix}"

      enc_name=$(nb_urlencode "$ifName")
      iface_id=$(nb_get "dcim/interfaces" "device_id=${DEVICE_ID}&name=${enc_name}" \
        | jq -r '(.results // [])[] | select(.name == "'"$ifName"'") | .id' | head -n1)

      if [ -z "$iface_id" ]; then
        echo "  Warning: interface $ifName not found in NetBox – skipping $cidr"
        continue
      fi

      payload=$(jq -n \
        --arg address "$cidr" --argjson iface_id "$iface_id" \
        '{address:$address,assigned_object_type:"dcim.interface",assigned_object_id:$iface_id,status:"active"}')

      enc_cidr=$(nb_urlencode "$cidr")
      ip_id=$(nb_get "ipam/ip-addresses" "address=${enc_cidr}" \
        | jq -r '(.results // [])[] | select(.address == "'"$cidr"'") | .id' | head -n1)

      if [ -z "$ip_id" ]; then
        resp=$(nb_api POST ipam/ip-addresses "$payload")
        new_id=$(echo "$resp" | jq -r '.id // empty')
        [ -n "$new_id" ] && [ "$new_id" != "null" ] \
          && echo "  Created IPv4 $cidr on $ifName" \
          || echo "  ERROR creating IPv4 $cidr: $(echo "$resp" | jq -c .)"
      else
        resp=$(nb_api PATCH "ipam/ip-addresses/$ip_id" "$payload")
        chk=$(echo "$resp" | jq -r '.id // empty')
        [ -n "$chk" ] && [ "$chk" != "null" ] \
          && echo "  Updated IPv4 $cidr on $ifName" \
          || echo "  ERROR updating IPv4 $cidr: $(echo "$resp" | jq -c .)"
      fi
    fi
  done < "$TMPFILE"
  rm -f "$TMPFILE"

  # ---- 4. IPv6 addresses ----------------------------------------------------
  # RFC 4293: IP-MIB::ipAddressTable  OID 1.3.6.1.2.1.4.34
  #   ipAddressIfIndex  1.3.6.1.2.1.4.34.1.3
  #   ipAddressPfxLength 1.3.6.1.2.1.4.34.1.5
  #
  # With -On the IPv6 rows appear as:
  #   .1.3.6.1.2.1.4.34.1.3.2.16.253.104.30.2.220.26.0.5.0.0.0.0.0.0.0.3 = INTEGER: 7
  #   addrType=2 (IPv6), addrLen=16, then 16 decimal bytes
  echo "Walking IPv6 addresses..."
  TMPFILE=$(mktemp)
  snmpwalk -On -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" 1.3.6.1.2.1.4.34.1 \
    2>/dev/null > "$TMPFILE" || true
  ipv6_count=$(grep -cE '\.1\.3\.6\.1\.2\.1\.4\.34\.1\.3\.2\.16\.' "$TMPFILE" || true)
  echo "  Found $ipv6_count IPv6 address entries"
  dbg "Raw ipAddressTable sample:"; [ "$DEBUG" -eq 1 ] && head -6 "$TMPFILE" | sed 's/^/  [raw] /' >&2

  while IFS= read -r line; do
    # Match ipAddressIfIndex rows for IPv6 (addrType=2, addrLen=16)
    # .1.3.6.1.2.1.4.34.1.3.2.16.B1.B2...B16 = INTEGER: ifIndex
    if echo "$line" | grep -qE '\.1\.3\.6\.1\.2\.1\.4\.34\.1\.3\.2\.16(\.[0-9]+){16} = INTEGER: [0-9]+'; then
      # Extract the 16 decimal bytes from the OID suffix
      oid_suffix=$(echo "$line" | sed 's/.*\.4\.34\.1\.3\.2\.16\.\([0-9.]*\) .*/\1/')
      ifIndex=$(echo "$line" | sed 's/.*INTEGER: //')

      # Convert OID decimal bytes to IPv6
      bytes=$(echo "$oid_suffix" | tr '.' ' ')
      ip6=$(dec_bytes_to_ipv6 "$bytes")
      [ -z "$ip6" ] && { echo "  Warning: could not convert OID bytes: $oid_suffix"; continue; }

      # Skip link-local
      echo "$ip6" | grep -qi '^fe80' && continue

      # Interface name
      ifName=$(snmpget -On -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" \
        "1.3.6.1.2.1.2.2.1.2.${ifIndex}" 2>/dev/null \
        | sed 's/.*STRING: //; s/^"//; s/"$//')
      [ -z "$ifName" ] && continue

      # Prefix length: ipAddressPfxLength  1.3.6.1.2.1.4.34.1.5.2.16.B1...B16
      prefix=128
      pfx_line=$(grep -E "\.1\.3\.6\.1\.2\.1\.4\.34\.1\.5\.2\.16\.${oid_suffix} " "$TMPFILE" || true)
      if echo "$pfx_line" | grep -qE 'INTEGER: [0-9]+'; then
        prefix=$(echo "$pfx_line" | sed 's/.*INTEGER: //')
      fi

      cidr="${ip6}/${prefix}"

      enc_name=$(nb_urlencode "$ifName")
      iface_id=$(nb_get "dcim/interfaces" "device_id=${DEVICE_ID}&name=${enc_name}" \
        | jq -r '(.results // [])[] | select(.name == "'"$ifName"'") | .id' | head -n1)

      if [ -z "$iface_id" ]; then
        echo "  Warning: interface $ifName not found in NetBox – skipping $cidr"
        continue
      fi

      payload=$(jq -n \
        --arg address "$cidr" --argjson iface_id "$iface_id" \
        '{address:$address,assigned_object_type:"dcim.interface",assigned_object_id:$iface_id,status:"active"}')

      enc_cidr=$(nb_urlencode "$cidr")
      ip_id=$(nb_get "ipam/ip-addresses" "address=${enc_cidr}" \
        | jq -r '(.results // [])[] | select(.address == "'"$cidr"'") | .id' | head -n1)

      if [ -z "$ip_id" ]; then
        resp=$(nb_api POST ipam/ip-addresses "$payload")
        new_id=$(echo "$resp" | jq -r '.id // empty')
        [ -n "$new_id" ] && [ "$new_id" != "null" ] \
          && echo "  Created IPv6 $cidr on $ifName" \
          || echo "  ERROR creating IPv6 $cidr: $(echo "$resp" | jq -c .)"
      else
        resp=$(nb_api PATCH "ipam/ip-addresses/$ip_id" "$payload")
        chk=$(echo "$resp" | jq -r '.id // empty')
        [ -n "$chk" ] && [ "$chk" != "null" ] \
          && echo "  Updated IPv6 $cidr on $ifName" \
          || echo "  ERROR updating IPv6 $cidr: $(echo "$resp" | jq -c .)"
      fi
    fi
  done < "$TMPFILE"
  rm -f "$TMPFILE"

  # ---- 5. Serial number -----------------------------------------------------
  echo "Fetching serial number..."
  SERIAL=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" \
    ENTITY-MIB::entPhysicalSerialNum 2>/dev/null \
    | head -n1 | sed 's/.*STRING: //; s/^"//; s/"$//' || true)
  if [ -n "$SERIAL" ]; then
    resp=$(nb_api PATCH "dcim/devices/$DEVICE_ID" \
      "$(jq -n --arg serial "$SERIAL" '{serial:$serial}')")
    chk=$(echo "$resp" | jq -r '.id // empty')
    [ -n "$chk" ] && [ "$chk" != "null" ] \
      && echo "  Serial: $SERIAL" \
      || echo "  Warning: serial update failed: $(echo "$resp" | jq -c .)"
  fi

  # ---- 6. VRFs (Cisco-only, silently skipped on non-Cisco) -----------------
  VRFS=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" \
    CISCO-VRF-MIB::ciscoVrfName 2>/dev/null || true)
  if echo "$VRFS" | grep -q 'STRING:'; then
    echo "Processing VRFs..."
    TMPFILE=$(mktemp)
    echo "$VRFS" > "$TMPFILE"
    while IFS= read -r line; do
      if echo "$line" | grep -qE 'CISCO-VRF-MIB::ciscoVrfName\.[0-9]+ = STRING: .+'; then
        vrf_name=$(snmp_str "$line")
        [ -z "$vrf_name" ] && continue
        enc_vrf=$(nb_urlencode "$vrf_name")
        existing=$(nb_get "ipam/vrfs" "name=${enc_vrf}" \
          | jq -r '(.results // [])[] | select(.name == "'"$vrf_name"'") | .id' | head -n1)
        payload=$(jq -n --arg name "$vrf_name" '{name:$name}')
        if [ -z "$existing" ]; then
          resp=$(nb_api POST ipam/vrfs "$payload")
          new_id=$(echo "$resp" | jq -r '.id // empty')
          [ -n "$new_id" ] && [ "$new_id" != "null" ] && echo "  Created VRF $vrf_name" \
            || echo "  ERROR creating VRF $vrf_name: $(echo "$resp" | jq -c .)"
        else
          nb_api PATCH "ipam/vrfs/$existing" "$payload" >/dev/null
          echo "  Updated VRF $vrf_name"
        fi
      fi
    done < "$TMPFILE"
    rm -f "$TMPFILE"
  fi

  # ---- 7. VLANs (Q-BRIDGE-MIB) ---------------------------------------------
  VLANs=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" \
    Q-BRIDGE-MIB::dot1qVlanStaticName 2>/dev/null || true)
  if echo "$VLANs" | grep -q 'STRING:'; then
    echo "Processing VLANs..."
    TMPFILE=$(mktemp)
    echo "$VLANs" > "$TMPFILE"
    while IFS= read -r line; do
      if echo "$line" | grep -qE 'Q-BRIDGE-MIB::dot1qVlanStaticName\.[0-9]+ = STRING: .*'; then
        vlan_id=$(echo "$line" | sed 's/.*dot1qVlanStaticName\.\([0-9]*\).*/\1/')
        vlan_name=$(snmp_str "$line")
        [ -z "$vlan_name" ] && vlan_name="VLAN${vlan_id}"
        existing=$(nb_get "ipam/vlans" "vid=${vlan_id}" \
          | jq -r "(.results // [])[] | select(.vid == ${vlan_id}) | .id" | head -n1)
        payload=$(jq -n \
          --arg name "$vlan_name" --argjson vid "$vlan_id" \
          '{name:$name,vid:$vid,status:"active"}')
        if [ -z "$existing" ]; then
          resp=$(nb_api POST ipam/vlans "$payload")
          new_id=$(echo "$resp" | jq -r '.id // empty')
          [ -n "$new_id" ] && [ "$new_id" != "null" ] \
            && echo "  Created VLAN $vlan_name (VID $vlan_id)" \
            || echo "  ERROR creating VLAN $vlan_name: $(echo "$resp" | jq -c .)"
        else
          nb_api PATCH "ipam/vlans/$existing" "$payload" >/dev/null
          echo "  Updated VLAN $vlan_name (VID $vlan_id)"
        fi
      fi
    done < "$TMPFILE"
    rm -f "$TMPFILE"
  fi

  echo "Done: $DEVICE_NAME"
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if [ -n "$CSV_FILE" ]; then
  [ -f "$CSV_FILE" ] || { echo "Error: $CSV_FILE not found."; exit 1; }
  echo "Reading from CSV: $CSV_FILE"
  sed 's/\r$//' "$CSV_FILE" | while IFS=, read -r csv_ip csv_name csv_site csv_role csv_type; do
    if [ -n "$csv_ip" ] && [ -n "$csv_name" ] \
       && [ "$csv_ip" != "IP" ] && [ "$csv_ip" != "ip" ]; then
      process_device "$csv_ip" "$csv_name" \
        "${csv_site:-$SITE_NAME_GLOBAL}" \
        "${csv_role:-$ROLE_NAME_GLOBAL}" \
        "${csv_type:-$TYPE_NAME_GLOBAL}"
    fi
  done
else
  process_device "$DEVICE_IP" "$DEVICE_NAME" \
    "$SITE_NAME_GLOBAL" "$ROLE_NAME_GLOBAL" "$TYPE_NAME_GLOBAL"
fi
