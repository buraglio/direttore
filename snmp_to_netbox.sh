#!/bin/sh

# snmp_to_netbox.sh
# ------------------------------------------------------------
# This script walks a network device via SNMP and pushes the discovered
# data into NetBox using its REST API.
#
# Requirements:
#   * snmpwalk / snmpget (net-snmp package)
#   * curl
#   * jq
#
# Environment variables (required):
#   NETBOX_URL     – Base URL of the NetBox instance (e.g. http://netbox.local:8000)
#   NETBOX_TOKEN   – NetBox API token with write permissions
#   SNMP_COMMUNITY – SNMP community string (default: public)
#
# Usage (Single Device):
#   ./snmp_to_netbox.sh [-s SITE_NAME] [-r ROLE_NAME] [-t TYPE_NAME] <DEVICE_IP> <DEVICE_NAME>
#
# Usage (Bulk CSV):
#   ./snmp_to_netbox.sh [-s SITE_NAME] [-r ROLE_NAME] [-t TYPE_NAME] -f <CSV_FILE>
#
# Options:
#   -s SITE_NAME  Create/Use this Site (instead of picking the first available)
#   -r ROLE_NAME  Create/Use this Device Role (instead of picking the first available)
#   -t TYPE_NAME  Create/Use this Device Type (instead of picking the first available)
#   -f CSV_FILE   Read from CSV file. Format: IP,NAME,[SITE],[ROLE],[TYPE]
#                 (Columns left blank in CSV will fallback to the CLI flags or defaults)
#
# Note: DEVICE_IP and CSV IP columns can be a literal IPv4 address, a literal
#       IPv6 address, or a DNS hostname (resolving to A or AAAA records).
#       IPv6 literals and udp6: hostnames are handled automatically.
# ------------------------------------------------------------

set -eu

SITE_NAME_GLOBAL=""
ROLE_NAME_GLOBAL=""
TYPE_NAME_GLOBAL=""
CSV_FILE=""

while getopts "s:r:t:f:h" opt; do
  case "$opt" in
    s) SITE_NAME_GLOBAL="$OPTARG" ;;
    r) ROLE_NAME_GLOBAL="$OPTARG" ;;
    t) TYPE_NAME_GLOBAL="$OPTARG" ;;
    f) CSV_FILE="$OPTARG" ;;
    h) echo "Usage: $0 [-s site] [-r role] [-t type] [-f csv_file] [<DEVICE_IP> <DEVICE_NAME>]"; exit 0 ;;
    *) echo "Usage: $0 [-s site] [-r role] [-t type] [-f csv_file] [<DEVICE_IP> <DEVICE_NAME>]"; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

DEVICE_IP="${1:-}"
DEVICE_NAME="${2:-}"

if [ -z "$CSV_FILE" ] && { [ -z "$DEVICE_IP" ] || [ -z "$DEVICE_NAME" ]; }; then
  echo "Usage: $0 [-s site] [-r role] [-t type] [-f csv_file] [<DEVICE_IP> <DEVICE_NAME>]"
  exit 1
fi

# Load variables from .env if present
if [ -f ".env" ]; then
  set -a
  . ./.env
  set +a
fi

: "${NETBOX_URL:?NETBOX_URL environment variable required}"
: "${NETBOX_TOKEN:?NETBOX_TOKEN environment variable required}"
SNMP_COMMUNITY="${SNMP_COMMUNITY:-public}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# nb_api METHOD endpoint [json_body]
# Always returns the raw response body; exits non-zero only on curl failure.
nb_api() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"
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

# nb_get endpoint query_string  → returns JSON body
# query_string is appended verbatim: "param1=val1&param2=val2"
# For values that contain '/' (e.g. CIDR), encode them with nb_urlencode first.
nb_get() {
  curl -sS "${NETBOX_URL}/api/${1}/?${2}" \
    -H "Authorization: Token $NETBOX_TOKEN" \
    -H "Content-Type: application/json"
}

# nb_urlencode string  → percent-encode characters unsafe in query values
nb_urlencode() {
  printf '%s' "$1" | jq -Rr @uri
}

# mask_to_prefix  dotted-decimal-mask  → prefix-length integer
mask_to_prefix() {
  local mask="$1"
  local prefix=0
  local IFS='.'
  for octet in $mask; do
    case "$octet" in
      255) prefix=$((prefix + 8)) ;;
      254) prefix=$((prefix + 7)) ;;
      252) prefix=$((prefix + 6)) ;;
      248) prefix=$((prefix + 5)) ;;
      240) prefix=$((prefix + 4)) ;;
      224) prefix=$((prefix + 3)) ;;
      192) prefix=$((prefix + 2)) ;;
      128) prefix=$((prefix + 1)) ;;
      0)   ;;
    esac
  done
  echo "$prefix"
}

# snmp_str line  → strip MIB prefix and quote chars from "STRING: value"
snmp_str() {
  echo "$1" | sed 's/.*STRING: //; s/^"//; s/"$//'
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

  # ------------------------------------------------------------------
  # Determine SNMP transport target
  # ------------------------------------------------------------------
  local SNMP_TARGET="$DEVICE_IP"
  if echo "$DEVICE_IP" | grep -qE "^udp6?:"; then
    SNMP_TARGET="$DEVICE_IP"
  elif echo "$DEVICE_IP" | grep -q ":"; then
    # Bare IPv6 literal
    SNMP_TARGET="udp6:[$DEVICE_IP]"
  elif echo "$DEVICE_IP" | grep -qE "^[0-9]{1,3}(\.[0-9]{1,3}){3}$"; then
    SNMP_TARGET="udp:$DEVICE_IP"
  else
    # Hostname – probe to find which transport works
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

  # ------------------------------------------------------------------
  # 1. Ensure device exists in NetBox (or create it)
  # ------------------------------------------------------------------
  # Use exact name filter; URL-encode the name to handle special chars
  enc_dname=$(nb_urlencode "$DEVICE_NAME")
  DEVICE_ID=$(nb_get "dcim/devices" "name=${enc_dname}" | jq -r '(.results // [])[] | select(.name == "'"$DEVICE_NAME"'") | .id' | head -n1)

  if [ -z "$DEVICE_ID" ]; then
    echo "Device $DEVICE_NAME not found in NetBox – creating..."

    # Site
    if [ -n "$SITE_NAME" ]; then
      SITE_ID=$(nb_get "dcim/sites" "name=${SITE_NAME}" | jq -r '.results[0].id // empty')
      if [ -z "$SITE_ID" ]; then
        echo "  Creating site $SITE_NAME..."
        slug=$(echo "$SITE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')
        SITE_ID=$(nb_api POST dcim/sites \
          "$(jq -n --arg name "$SITE_NAME" --arg slug "$slug" '{name:$name,slug:$slug,status:"active"}')" \
          | jq -r '.id // empty')
      fi
    else
      SITE_ID=$(nb_api GET "dcim/sites?limit=1" | jq -r '.results[0].id // empty')
    fi

    # Role
    if [ -n "$ROLE_NAME" ]; then
      ROLE_ID=$(nb_get "dcim/device-roles" "name=${ROLE_NAME}" | jq -r '.results[0].id // empty')
      if [ -z "$ROLE_ID" ]; then
        echo "  Creating role $ROLE_NAME..."
        slug=$(echo "$ROLE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')
        ROLE_ID=$(nb_api POST dcim/device-roles \
          "$(jq -n --arg name "$ROLE_NAME" --arg slug "$slug" '{name:$name,slug:$slug,color:"9e9e9e"}')" \
          | jq -r '.id // empty')
      fi
    else
      ROLE_ID=$(nb_api GET "dcim/device-roles?limit=1" | jq -r '.results[0].id // empty')
    fi

    # Type / Manufacturer
    if [ -n "$TYPE_NAME" ]; then
      TYPE_ID=$(nb_get "dcim/device-types" "model=${TYPE_NAME}" | jq -r '.results[0].id // empty')
      if [ -z "$TYPE_ID" ]; then
        echo "  Creating device type $TYPE_NAME..."
        slug=$(echo "$TYPE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')
        MFG_ID=$(nb_get "dcim/manufacturers" "name=Generic" | jq -r '.results[0].id // empty')
        if [ -z "$MFG_ID" ]; then
          MFG_ID=$(nb_api POST dcim/manufacturers \
            "$(jq -n '{name:"Generic",slug:"generic"}')" \
            | jq -r '.id // empty')
        fi
        TYPE_ID=$(nb_api POST dcim/device-types \
          "$(jq -n --arg model "$TYPE_NAME" --arg slug "$slug" --arg mfg "$MFG_ID" \
             '{manufacturer:($mfg|tonumber),model:$model,slug:$slug}')" \
          | jq -r '.id // empty')
      fi
    else
      TYPE_ID=$(nb_api GET "dcim/device-types?limit=1" | jq -r '.results[0].id // empty')
    fi

    if [ -z "${SITE_ID:-}" ] || [ -z "${ROLE_ID:-}" ] || [ -z "${TYPE_ID:-}" ]; then
      echo "ERROR: Missing site/role/type – cannot create device."
      echo "  SITE_ID='${SITE_ID:-}' ROLE_ID='${ROLE_ID:-}' TYPE_ID='${TYPE_ID:-}'"
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
      echo "ERROR: Failed to create device. NetBox response:"
      echo "$resp" | jq .
      return 1
    fi
    echo "Created device $DEVICE_NAME with ID $DEVICE_ID"
  else
    echo "Device $DEVICE_NAME exists with ID $DEVICE_ID"
  fi

  # ------------------------------------------------------------------
  # 2. Walk interfaces (IF-MIB::ifDescr)
  #    We use a temp file to avoid subshell scoping issues with pipes.
  # ------------------------------------------------------------------
  echo "Walking interfaces..."
  TMPFILE=$(mktemp)
  snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" IF-MIB::ifDescr 2>/dev/null > "$TMPFILE" || true

  while IFS= read -r line; do
    # IF-MIB::ifDescr.4 = STRING: ether1
    if echo "$line" | grep -qE 'IF-MIB::ifDescr\.[0-9]+ = STRING: .+'; then
      ifIndex=$(echo "$line" | sed 's/.*IF-MIB::ifDescr\.\([0-9]*\).*/\1/')
      ifName=$(snmp_str "$line")
      [ -z "$ifName" ] && continue

      payload=$(jq -n \
        --arg name "$ifName" \
        --argjson dev "$DEVICE_ID" \
        '{name:$name, device:$dev, type:"other"}')

      enc_name=$(nb_urlencode "$ifName")
      iface_id=$(nb_get "dcim/interfaces" "device_id=${DEVICE_ID}&name=${enc_name}" \
        | jq -r '(.results // [])[] | select(.name == "'"$ifName"'") | .id' | head -n1)

      if [ -z "$iface_id" ]; then
        resp=$(nb_api POST dcim/interfaces "$payload")
        new_id=$(echo "$resp" | jq -r '.id // empty')
        if [ -n "$new_id" ] && [ "$new_id" != "null" ]; then
          echo "  Created interface $ifName (id=$new_id)"
        else
          echo "  ERROR creating interface $ifName: $(echo "$resp" | jq -c .)"
        fi
      else
        resp=$(nb_api PATCH "dcim/interfaces/$iface_id" "$payload")
        chk=$(echo "$resp" | jq -r '.id // empty')
        if [ -n "$chk" ] && [ "$chk" != "null" ]; then
          echo "  Updated interface $ifName (id=$iface_id)"
        else
          echo "  ERROR updating interface $ifName: $(echo "$resp" | jq -c .)"
        fi
      fi
    fi
  done < "$TMPFILE"
  rm -f "$TMPFILE"

  # ------------------------------------------------------------------
  # 3. Walk IPv4 addresses
  #    Fetch real prefix length from ipAdEntNetMask.
  # ------------------------------------------------------------------
  echo "Walking IPv4 addresses..."
  TMPFILE=$(mktemp)
  snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" IP-MIB::ipAdEntAddr 2>/dev/null > "$TMPFILE" || true

  while IFS= read -r line; do
    # IP-MIB::ipAdEntAddr.10.0.0.1 = IpAddress: 10.0.0.1
    if echo "$line" | grep -qE 'IP-MIB::ipAdEntAddr\.[0-9.]+ = IpAddress: .+'; then
      ip=$(echo "$line" | sed 's/.*IpAddress: //')

      # Get ifIndex for this IP
      idx_line=$(snmpget -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" \
        "IP-MIB::ipAdEntIfIndex.$ip" 2>/dev/null || true)
      echo "$idx_line" | grep -qE 'INTEGER: [0-9]+' || continue
      ifIndex=$(echo "$idx_line" | sed 's/.*INTEGER: //')

      # Get interface name
      ifName=$(snmpget -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" \
        "IF-MIB::ifDescr.$ifIndex" 2>/dev/null | snmp_str /dev/stdin || true)
      # snmp_str expects a string arg, use inline
      ifName=$(snmpget -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" \
        "IF-MIB::ifDescr.$ifIndex" 2>/dev/null \
        | sed 's/.*STRING: //; s/^"//; s/"$//')
      [ -z "$ifName" ] && continue

      # Get subnet mask → convert to prefix length
      mask_line=$(snmpget -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" \
        "IP-MIB::ipAdEntNetMask.$ip" 2>/dev/null || true)
      if echo "$mask_line" | grep -qE 'IpAddress: [0-9.]+'; then
        mask=$(echo "$mask_line" | sed 's/.*IpAddress: //')
        prefix=$(mask_to_prefix "$mask")
      else
        prefix=32
      fi

      cidr="${ip}/${prefix}"

      # Find the NetBox interface ID for this device+ifName
      enc_name=$(nb_urlencode "$ifName")
      iface_id=$(nb_get "dcim/interfaces" "device_id=${DEVICE_ID}&name=${enc_name}" \
        | jq -r '(.results // [])[] | select(.name == "'"$ifName"'") | .id' | head -n1)

      if [ -z "$iface_id" ]; then
        echo "  Warning: interface $ifName not in NetBox yet – skipping IP $cidr"
        continue
      fi

      payload=$(jq -n \
        --arg address "$cidr" \
        --argjson iface_id "$iface_id" \
        '{address:$address,
          assigned_object_type:"dcim.interface",
          assigned_object_id:$iface_id,
          status:"active"}')

      # Search for existing IP (URL-encode the slash)
      enc_cidr=$(nb_urlencode "$cidr")
      ip_id=$(nb_get "ipam/ip-addresses" "address=${enc_cidr}" \
        | jq -r '(.results // [])[] | select(.address == "'"$cidr"'") | .id' | head -n1)

      if [ -z "$ip_id" ]; then
        resp=$(nb_api POST ipam/ip-addresses "$payload")
        new_id=$(echo "$resp" | jq -r '.id // empty')
        if [ -n "$new_id" ] && [ "$new_id" != "null" ]; then
          echo "  Created IPv4 $cidr on $ifName"
        else
          echo "  ERROR creating IPv4 $cidr: $(echo "$resp" | jq -c .)"
        fi
      else
        resp=$(nb_api PATCH "ipam/ip-addresses/$ip_id" "$payload")
        chk=$(echo "$resp" | jq -r '.id // empty')
        if [ -n "$chk" ] && [ "$chk" != "null" ]; then
          echo "  Updated IPv4 $cidr on $ifName"
        else
          echo "  ERROR updating IPv4 $cidr: $(echo "$resp" | jq -c .)"
        fi
      fi
    fi
  done < "$TMPFILE"
  rm -f "$TMPFILE"

  # ------------------------------------------------------------------
  # 4. Walk IPv6 addresses via RFC 4293 IP-MIB::ipAddressAddr
  #    (IPV6-MIB is obsolete; RouterOS and most modern devices use RFC 4293)
  # ------------------------------------------------------------------
  echo "Walking IPv6 addresses..."
  TMPFILE=$(mktemp)
  snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" IP-MIB::ipAddressIfIndex 2>/dev/null > "$TMPFILE" || true

  while IFS= read -r line; do
    # IP-MIB::ipAddressIfIndex.ipv6."fd68:1e02:dc1a:ffff::1" = INTEGER: 13
    if echo "$line" | grep -qE 'IP-MIB::ipAddressIfIndex\.ipv6\."[^"]+" = INTEGER: [0-9]+'; then
      ip6=$(echo "$line" | sed 's/.*ipv6\."\([^"]*\)".*/\1/')
      ifIndex=$(echo "$line" | sed 's/.*INTEGER: //')

      # Skip link-local addresses (fe80::)
      echo "$ip6" | grep -qi '^fe80' && continue

      ifName=$(snmpget -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" \
        "IF-MIB::ifDescr.$ifIndex" 2>/dev/null \
        | sed 's/.*STRING: //; s/^"//; s/"$//')
      [ -z "$ifName" ] && continue

      # Get prefix length via ipAddressPrefix (may not be supported everywhere)
      prefix=128
      pfx_line=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" \
        "IP-MIB::ipAddressPrefix" 2>/dev/null | grep "\"$ip6\"" || true)
      if echo "$pfx_line" | grep -qE 'INTEGER: [0-9]+'; then
        prefix=$(echo "$pfx_line" | sed 's/.*INTEGER: //')
      fi

      cidr="${ip6}/${prefix}"

      enc_name=$(nb_urlencode "$ifName")
      iface_id=$(nb_get "dcim/interfaces" "device_id=${DEVICE_ID}&name=${enc_name}" \
        | jq -r '(.results // [])[] | select(.name == "'"$ifName"'") | .id' | head -n1)

      if [ -z "$iface_id" ]; then
        echo "  Warning: interface $ifName not in NetBox yet – skipping IPv6 $cidr"
        continue
      fi

      payload=$(jq -n \
        --arg address "$cidr" \
        --argjson iface_id "$iface_id" \
        '{address:$address,
          assigned_object_type:"dcim.interface",
          assigned_object_id:$iface_id,
          status:"active"}')

      enc_cidr=$(nb_urlencode "$cidr")
      ip_id=$(nb_get "ipam/ip-addresses" "address=${enc_cidr}" \
        | jq -r '(.results // [])[] | select(.address == "'"$cidr"'") | .id' | head -n1)

      if [ -z "$ip_id" ]; then
        resp=$(nb_api POST ipam/ip-addresses "$payload")
        new_id=$(echo "$resp" | jq -r '.id // empty')
        if [ -n "$new_id" ] && [ "$new_id" != "null" ]; then
          echo "  Created IPv6 $cidr on $ifName"
        else
          echo "  ERROR creating IPv6 $cidr: $(echo "$resp" | jq -c .)"
        fi
      else
        resp=$(nb_api PATCH "ipam/ip-addresses/$ip_id" "$payload")
        chk=$(echo "$resp" | jq -r '.id // empty')
        if [ -n "$chk" ] && [ "$chk" != "null" ]; then
          echo "  Updated IPv6 $cidr on $ifName"
        else
          echo "  ERROR updating IPv6 $cidr: $(echo "$resp" | jq -c .)"
        fi
      fi
    fi
  done < "$TMPFILE"
  rm -f "$TMPFILE"

  # ------------------------------------------------------------------
  # 5. Serial number (ENTITY-MIB::entPhysicalSerialNum)
  # ------------------------------------------------------------------
  echo "Fetching serial number..."
  SERIAL=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" \
    ENTITY-MIB::entPhysicalSerialNum 2>/dev/null \
    | head -n1 | sed 's/.*STRING: //; s/^"//; s/"$//' || true)
  if [ -n "$SERIAL" ]; then
    resp=$(nb_api PATCH "dcim/devices/$DEVICE_ID" \
      "$(jq -n --arg serial "$SERIAL" '{serial:$serial}')")
    chk=$(echo "$resp" | jq -r '.id // empty')
    if [ -n "$chk" ] && [ "$chk" != "null" ]; then
      echo "  Updated serial number: $SERIAL"
    else
      echo "  Warning: could not update serial number: $(echo "$resp" | jq -c .)"
    fi
  fi

  # ------------------------------------------------------------------
  # 6. VRFs (CISCO-VRF-MIB – optional, suppressed if MIB missing)
  # ------------------------------------------------------------------
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

  # ------------------------------------------------------------------
  # 7. VLANs (Q-BRIDGE-MIB::dot1qVlanStaticName)
  # ------------------------------------------------------------------
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
          --arg name "$vlan_name" \
          --argjson vid "$vlan_id" \
          '{name:$name, vid:$vid, status:"active"}')
        if [ -z "$existing" ]; then
          resp=$(nb_api POST ipam/vlans "$payload")
          new_id=$(echo "$resp" | jq -r '.id // empty')
          [ -n "$new_id" ] && [ "$new_id" != "null" ] && echo "  Created VLAN $vlan_name (VID $vlan_id)" \
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
  if [ ! -f "$CSV_FILE" ]; then
    echo "Error: CSV file $CSV_FILE not found."
    exit 1
  fi
  echo "Reading from CSV: $CSV_FILE"
  sed 's/\r$//' "$CSV_FILE" | while IFS=, read -r csv_ip csv_name csv_site csv_role csv_type; do
    if [ -n "$csv_ip" ] && [ -n "$csv_name" ] && [ "$csv_ip" != "IP" ] && [ "$csv_ip" != "ip" ]; then
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
