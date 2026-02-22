#!/bin/sh

# snmp_to_netbox.sh
# ------------------------------------------------------------
# This script walks a network device via SNMP and pushes the discovered
# data into NetBox using its REST API.
#
# Requirements:
#   * snmpwalk (net-snmp package)
#   * curl
#   * jq (for JSON handling – optional, but used for readability)
#
# Environment variables (required):
#   NETBOX_URL   – Base URL of the NetBox instance (e.g. http://netbox.local:8000)
#   NETBOX_TOKEN – NetBox API token with write permissions
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

# Configuration
# Load variables from .env if present
if [ -f ".env" ]; then
  set -a
  . ./.env
  set +a
fi

: "${NETBOX_URL:?NETBOX_URL environment variable required}"
: "${NETBOX_TOKEN:?NETBOX_TOKEN environment variable required}"
SNMP_COMMUNITY="${SNMP_COMMUNITY:-public}"

# Helper to call NetBox API
nb_api() {
  local method=$1
  local endpoint=$2
  local data=${3:-}
  if [ -n "$data" ]; then
    curl -sS -X "$method" "$NETBOX_URL/api/$endpoint/" \
      -H "Authorization: Token $NETBOX_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$data"
  else
    curl -sS -X "$method" "$NETBOX_URL/api/$endpoint/" \
      -H "Authorization: Token $NETBOX_TOKEN" \
      -H "Content-Type: application/json"
  fi
}

process_device() {
  local DEVICE_IP="$1"
  local DEVICE_NAME="$2"
  local SITE_NAME="${3:-$SITE_NAME_GLOBAL}"
  local ROLE_NAME="${4:-$ROLE_NAME_GLOBAL}"
  local TYPE_NAME="${5:-$TYPE_NAME_GLOBAL}"

  # Format DEVICE_IP properly for snmp tools
  # Input can be a literal IP, a DNS name (A/AAAA), or a literal IPv6 address
  local SNMP_TARGET="$DEVICE_IP"
  if echo "$DEVICE_IP" | grep -qE "^udp6?:"; then
    # Already has transport specified, leave it alone
    SNMP_TARGET="$DEVICE_IP"
  elif echo "$DEVICE_IP" | grep -q ":"; then
    SNMP_TARGET="udp6:[$DEVICE_IP]"
  elif echo "$DEVICE_IP" | grep -qE "^[0-9]{1,3}(\.[0-9]{1,3}){3}$"; then
    SNMP_TARGET="udp:$DEVICE_IP"
  else
    # Hostname: try to determine if it responds on IPv4 or IPv6
    if snmpget -v2c -c "$SNMP_COMMUNITY" -t 1 -r 0 "udp:$DEVICE_IP" 1.3.6.1.2.1.1.1.0 >/dev/null 2>&1; then
      SNMP_TARGET="udp:$DEVICE_IP"
    elif snmpget -v2c -c "$SNMP_COMMUNITY" -t 1 -r 0 "udp6:$DEVICE_IP" 1.3.6.1.2.1.1.1.0 >/dev/null 2>&1; then
      SNMP_TARGET="udp6:$DEVICE_IP"
    fi
  fi

  echo ""
  echo "============================================================"
  echo "Processing Device: $DEVICE_NAME ($DEVICE_IP)"
  echo "Targeting SNMP at: $SNMP_TARGET"
  echo "============================================================"

  # 1. Ensure device exists (or create it)
  DEVICE_ID=$(nb_api GET dcim/devices "?name=$DEVICE_NAME" | jq -r '.results[0].id // empty')
  if [ -z "$DEVICE_ID" ]; then
    echo "Device $DEVICE_NAME not found in NetBox – creating..."
    # Fetch or create SITE
    if [ -n "$SITE_NAME" ]; then
      SITE_ID=$(nb_api GET dcim/sites "?name=$SITE_NAME" | jq -r '.results[0].id // empty')
      if [ -z "$SITE_ID" ]; then
        echo "Creating Site $SITE_NAME..."
        slug=$(echo "$SITE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')
        payload=$(jq -n --arg name "$SITE_NAME" --arg slug "$slug" '{name: $name, slug: $slug, status: "active"}')
        SITE_ID=$(nb_api POST dcim/sites "$payload" | jq -r '.id // empty')
      fi
    else
      SITE_ID=$(nb_api GET dcim/sites "?limit=1" | jq -r '.results[0].id // empty')
    fi

    # Fetch or create ROLE
    if [ -n "$ROLE_NAME" ]; then
      ROLE_ID=$(nb_api GET dcim/device-roles "?name=$ROLE_NAME" | jq -r '.results[0].id // empty')
      if [ -z "$ROLE_ID" ]; then
        echo "Creating Device Role $ROLE_NAME..."
        slug=$(echo "$ROLE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')
        payload=$(jq -n --arg name "$ROLE_NAME" --arg slug "$slug" '{name: $name, slug: $slug, color: "9e9e9e"}')
        ROLE_ID=$(nb_api POST dcim/device-roles "$payload" | jq -r '.id // empty')
      fi
    else
      ROLE_ID=$(nb_api GET dcim/device-roles "?limit=1" | jq -r '.results[0].id // empty')
    fi

    # Fetch or create TYPE (requires Manufacturer)
    if [ -n "$TYPE_NAME" ]; then
      TYPE_ID=$(nb_api GET dcim/device-types "?model=$TYPE_NAME" | jq -r '.results[0].id // empty')
      if [ -z "$TYPE_ID" ]; then
        echo "Creating Device Type $TYPE_NAME..."
        slug=$(echo "$TYPE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')
        MFG_ID=$(nb_api GET dcim/manufacturers "?name=Generic" | jq -r '.results[0].id // empty')
        if [ -z "$MFG_ID" ]; then
          payload=$(jq -n '{name: "Generic", slug: "generic"}')
          MFG_ID=$(nb_api POST dcim/manufacturers "$payload" | jq -r '.id // empty')
        fi
        payload=$(jq -n --arg model "$TYPE_NAME" --arg slug "$slug" --arg mfg "$MFG_ID" '{manufacturer: ($mfg|tonumber), model: $model, slug: $slug}')
        TYPE_ID=$(nb_api POST dcim/device-types "$payload" | jq -r '.id // empty')
      fi
    else
      TYPE_ID=$(nb_api GET dcim/device-types "?limit=1" | jq -r '.results[0].id // empty')
    fi
    
    if [ -z "$SITE_ID" ] || [ -z "$ROLE_ID" ] || [ -z "$TYPE_ID" ]; then
      echo "Error: Cannot create device. Ensure at least one Site, Device Role, and Device Type exist in NetBox."
      exit 1
    fi
    
    payload=$(jq -n \
      --arg name "$DEVICE_NAME" \
      --arg status "active" \
      --arg site "$SITE_ID" \
      --arg role "$ROLE_ID" \
      --arg type "$TYPE_ID" \
      '{name: $name, status: $status, device_type: ($type|tonumber), role: ($role|tonumber), site: ($site|tonumber)}')
    
    # Try to create device
    DEVICE_ID=$(nb_api POST dcim/devices "$payload" | jq -r '.id // empty')
    
    # Validate that creation actually succeeded
    if [ -z "$DEVICE_ID" ] || [ "$DEVICE_ID" = "null" ]; then
      echo "Failed to create device. Is the device name unique? Raw response payload:"
      nb_api POST dcim/devices "$payload"
      exit 1
    fi
    
    echo "Created device with ID $DEVICE_ID"
  else
    echo "Device $DEVICE_NAME exists with ID $DEVICE_ID"
  fi

  # 2. Walk interfaces (IF-MIB::ifDescr)
  echo "Walking interfaces..."
  INTERFACES=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" IF-MIB::ifDescr 2>/dev/null || true)
  echo "$INTERFACES" | while IFS= read -r line; do
    # Example line: IF-MIB::ifDescr.1 = STRING: lo
    if echo "$line" | grep -q 'IF-MIB::ifDescr\.[0-9]* = STRING: .*'; then
      ifIndex=$(echo "$line" | sed 's/.*IF-MIB::ifDescr\.\([0-9]*\).*/\1/')
      ifName=$(echo "$line" | sed 's/.*STRING: \(.*\)/\1/')
      
      # Create or update interface in NetBox
      payload=$(jq -n \
        --arg name "$ifName" \
        --arg device_id "$DEVICE_ID" \
        '{name: $name, device: ($device_id|tonumber)}')
      iface_id=$(nb_api GET dcim/interfaces "?device_id=$DEVICE_ID&name=$ifName" | jq -r '.results[0].id // empty')
      if [ -z "$iface_id" ]; then
        nb_api POST dcim/interfaces "$payload" > /dev/null
        echo "Created interface $ifName"
      else
        nb_api PATCH dcim/interfaces/"$iface_id" "$payload" > /dev/null
        echo "Updated interface $ifName"
      fi
    fi
  done

  # 3. Walk IPv4 addresses (IP-MIB::ipAddrTable)
  echo "Walking IPv4 addresses..."
  IPV4=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" IP-MIB::ipAdEntAddr 2>/dev/null || true)
  echo "$IPV4" | while IFS= read -r line; do
    # Example: IP-MIB::ipAdEntAddr.10.0.0.1 = IpAddress: 10.0.0.1
    if echo "$line" | grep -q 'IP-MIB::ipAdEntAddr\.[0-9.]* = IpAddress: .*'; then
      ip=$(echo "$line" | sed 's/.*IpAddress: \(.*\)/\1/')
      idx_line=$(snmpget -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" "IP-MIB::ipAdEntIfIndex.$ip" 2>/dev/null || true)
      
      if echo "$idx_line" | grep -q 'IP-MIB::ipAdEntIfIndex\.[0-9.]* = INTEGER: [0-9]*'; then
        ifIndex=$(echo "$idx_line" | sed 's/.*INTEGER: \([0-9]*\).*/\1/')
        ifName=$(snmpget -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" "IF-MIB::ifDescr.$ifIndex" 2>/dev/null | awk -F"STRING: " '{print $2}')
        
        payload=$(jq -n \
          --arg address "$ip/32" \
          --arg device_id "$DEVICE_ID" \
          --arg interface "$ifName" \
          '{address: $address, assigned_object_type: "dcim.interface", assigned_object_id: (null), status: "active"}')
        
        iface_id=$(nb_api GET dcim/interfaces "?device_id=$DEVICE_ID&name=$ifName" | jq -r '.results[0].id // empty')
        if [ -n "$iface_id" ]; then
          payload=$(echo "$payload" | jq ".assigned_object_id = ($iface_id|tonumber)")
          ip_id=$(nb_api GET ipam/ip-addresses "?address=$ip" | jq -r '.results[0].id // empty')
          if [ -z "$ip_id" ]; then
            nb_api POST ipam/ip-addresses "$payload" > /dev/null
            echo "Created IPv4 $ip on $ifName"
          else
            nb_api PATCH ipam/ip-addresses/"$ip_id" "$payload" > /dev/null
            echo "Updated IPv4 $ip on $ifName"
          fi
        fi
      fi
    fi
  done

  # 4. Walk IPv6 addresses (IPV6-MIB::ipv6AddrAddress)
  echo "Walking IPv6 addresses..."
  IPV6=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" IPV6-MIB::ipv6AddrAddress 2>/dev/null || true)
  echo "$IPV6" | while IFS= read -r line; do
    # Example: IPV6-MIB::ipv6AddrAddress.2001:db8::1 = IpAddress: 2001:db8::1
    if echo "$line" | grep -Eq 'IPV6-MIB::ipv6AddrAddress\.[0-9A-Fa-f:]* = IpAddress: .*'; then
      ip=$(echo "$line" | sed 's/.*IpAddress: \(.*\)/\1/')
      idx_line=$(snmpget -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" "IPV6-MIB::ipv6IfIndex.$ip" 2>/dev/null || true)
      
      if echo "$idx_line" | grep -q 'IPV6-MIB::ipv6IfIndex\.[0-9A-Fa-f:]* = INTEGER: [0-9]*'; then
        ifIndex=$(echo "$idx_line" | sed 's/.*INTEGER: \([0-9]*\).*/\1/')
        ifName=$(snmpget -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" "IF-MIB::ifDescr.$ifIndex" 2>/dev/null | awk -F"STRING: " '{print $2}')
        
        payload=$(jq -n \
          --arg address "$ip/128" \
          --arg device_id "$DEVICE_ID" \
          --arg interface "$ifName" \
          '{address: $address, assigned_object_type: "dcim.interface", assigned_object_id: (null), status: "active"}')
          
        iface_id=$(nb_api GET dcim/interfaces "?device_id=$DEVICE_ID&name=$ifName" | jq -r '.results[0].id // empty')
        if [ -n "$iface_id" ]; then
          payload=$(echo "$payload" | jq ".assigned_object_id = ($iface_id|tonumber)")
          ip_id=$(nb_api GET ipam/ip-addresses "?address=$ip" | jq -r '.results[0].id // empty')
          if [ -z "$ip_id" ]; then
            nb_api POST ipam/ip-addresses "$payload" > /dev/null
            echo "Created IPv6 $ip on $ifName"
          else
            nb_api PATCH ipam/ip-addresses/"$ip_id" "$payload" > /dev/null
            echo "Updated IPv6 $ip on $ifName"
          fi
        fi
      fi
    fi
  done

  # 5. Serial number (ENTITY-MIB::entPhysicalSerialNum)
  echo "Fetching serial number..."
  SERIAL=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" ENTITY-MIB::entPhysicalSerialNum 2>/dev/null | head -n1 | awk -F"STRING: " '{print $2}' || true)
  if [ -n "$SERIAL" ]; then
    payload=$(jq -n \
      --arg serial "$SERIAL" \
      '{serial: $serial}')
    nb_api PATCH dcim/devices/"$DEVICE_ID" "$payload" > /dev/null
    echo "Updated device serial number to $SERIAL"
  fi

  # 6. VRFs – optional via CISCO-VRF-MIB::ciscoVrfNameTable
  VRFS=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" CISCO-VRF-MIB::ciscoVrfName 2>/dev/null || true)
  if [ -n "$VRFS" ]; then
    echo "Processing VRFs..."
    echo "$VRFS" | while IFS= read -r line; do
      if echo "$line" | grep -q 'CISCO-VRF-MIB::ciscoVrfName\.[0-9]* = STRING: .*'; then
        vrf_id=$(echo "$line" | sed 's/.*CISCO-VRF-MIB::ciscoVrfName\.\([0-9]*\).*/\1/')
        vrf_name=$(echo "$line" | sed 's/.*STRING: \(.*\)/\1/')
        
        payload=$(jq -n \
          --arg name "$vrf_name" \
          '{name: $name, rd: ""}')
        existing=$(nb_api GET ipam/vrfs "?name=$vrf_name" | jq -r '.results[0].id // empty')
        if [ -z "$existing" ]; then
          nb_api POST ipam/vrfs "$payload" > /dev/null
          echo "Created VRF $vrf_name"
        else
          nb_api PATCH ipam/vrfs/"$existing" "$payload" > /dev/null
          echo "Updated VRF $vrf_name"
        fi
      fi
    done
  fi

  # 7. VLANs – discovered via Q-BRIDGE-MIB::dot1qVlanStaticName
  VLANs=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$SNMP_TARGET" Q-BRIDGE-MIB::dot1qVlanStaticName 2>/dev/null || true)
  if [ -n "$VLANs" ]; then
    echo "Processing VLANs..."
    echo "$VLANs" | while IFS= read -r line; do
      if echo "$line" | grep -q 'Q-BRIDGE-MIB::dot1qVlanStaticName\.[0-9]* = STRING: .*'; then
        vlan_id=$(echo "$line" | sed 's/.*Q-BRIDGE-MIB::dot1qVlanStaticName\.\([0-9]*\).*/\1/')
        vlan_name=$(echo "$line" | sed 's/.*STRING: //; s/^"//; s/"$//')
        
        payload=$(jq -n \
          --arg name "$vlan_name" \
          --arg vid "$vlan_id" \
          '{name: $name, vid: ($vid|tonumber), status: "active"}')
        existing=$(nb_api GET ipam/vlans "?vid=$vlan_id" | jq -r '.results[0].id // empty')
        if [ -z "$existing" ]; then
          nb_api POST ipam/vlans "$payload" > /dev/null
          echo "Created VLAN $vlan_name (VID $vlan_id)"
        else
          nb_api PATCH ipam/vlans/"$existing" "$payload" > /dev/null
          echo "Updated VLAN $vlan_name (VID $vlan_id)"
        fi
      fi
    done
  fi

  echo "SNMP to NetBox population complete for $DEVICE_NAME."
}

if [ -n "$CSV_FILE" ]; then
  if [ ! -f "$CSV_FILE" ]; then
    echo "Error: CSV file $CSV_FILE not found."
    exit 1
  fi
  
  echo "Reading from CSV: $CSV_FILE"
  # Support DOS line endings and skip empty lines
  sed 's/\r$//' "$CSV_FILE" | while IFS=, read -r csv_ip csv_name csv_site csv_role csv_type; do
    # Skip header line, if any, and empty lines
    if [ -n "$csv_ip" ] && [ -n "$csv_name" ] && [ "$csv_ip" != "IP" ] && [ "$csv_ip" != "ip" ]; then
      process_device "$csv_ip" "$csv_name" "$csv_site" "$csv_role" "$csv_type"
    fi
  done
else
  process_device "$DEVICE_IP" "$DEVICE_NAME" "$SITE_NAME_GLOBAL" "$ROLE_NAME_GLOBAL" "$TYPE_NAME_GLOBAL"
fi
