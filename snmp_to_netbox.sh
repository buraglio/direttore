#!/usr/bin/env bash

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
# Usage:
#   ./snmp_to_netbox.sh <DEVICE_IP> <DEVICE_NAME>
#   DEVICE_IP   – IP address of the device to query via SNMP
#   DEVICE_NAME – Name of the device as it should appear in NetBox
#
# The script performs the following steps:
#   1. Ensure the device exists in NetBox (creates it if missing).
#   2. Walk IF-MIB to discover interfaces and create/update them.
#   3. Walk IP-MIB (IPv4) and IP-MIB (IPv6) to discover addresses.
#   4. Walk ENTITY-MIB for serial numbers.
#   5. Walk VRF-MIB (if supported) for VRF information.
#   6. Push the collected data to NetBox via its API.
# ------------------------------------------------------------

set -eu

DEVICE_IP="${1:-}"
DEVICE_NAME="${2:-}"

if [[ -z "$DEVICE_IP" || -z "$DEVICE_NAME" ]]; then
  echo "Usage: $0 <DEVICE_IP> <DEVICE_NAME>"
  exit 1
fi

# Configuration
# Load variables from .env if present
if [[ -f ".env" ]]; then
  set -a
  source .env
  set +a
fi

: "${NETBOX_URL:?NETBOX_URL environment variable required}"
: "${NETBOX_TOKEN:?NETBOX_TOKEN environment variable required}"
SNMP_COMMUNITY="${SNMP_COMMUNITY:-public}"

# Helper to call NetBox API
nb_api() {
  local method=$1
  local endpoint=$2
  local data=$3
  if [[ -n "$data" ]]; then
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

# 1. Ensure device exists (or create it)
DEVICE_ID=$(nb_api GET dcim/devices "?name=$DEVICE_NAME" | jq -r '.results[0].id // empty')
if [[ -z "$DEVICE_ID" ]]; then
  echo "Device $DEVICE_NAME not found in NetBox – creating..."
  payload=$(jq -n \
    --arg name "$DEVICE_NAME" \
    --arg status "active" \
    '{name: $name, status: $status, device_type: 1, device_role: 1, site: 1}')
  DEVICE_ID=$(nb_api POST dcim/devices "$payload" | jq -r '.id')
  echo "Created device with ID $DEVICE_ID"
else
  echo "Device $DEVICE_NAME exists with ID $DEVICE_ID"
fi

# 2. Walk interfaces (IF-MIB::ifDescr)
echo "Walking interfaces..."
INTERFACES=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$DEVICE_IP" IF-MIB::ifDescr)
while IFS= read -r line; do
  # Example line: IF-MIB::ifDescr.1 = STRING: lo
  if [[ $line =~ ^IF-MIB::ifDescr\.([0-9]+)\ =\ STRING:\ (.+)$ ]]; then
    ifIndex=${BASH_REMATCH[1]}
    ifName=${BASH_REMATCH[2]}
    # Create or update interface in NetBox
    payload=$(jq -n \
      --arg name "$ifName" \
      --arg device_id "$DEVICE_ID" \
      '{name: $name, device: ($device_id|tonumber)}')
    # Check if interface already exists
    iface_id=$(nb_api GET dcim/interfaces "?device_id=$DEVICE_ID&name=$ifName" | jq -r '.results[0].id // empty')
    if [[ -z "$iface_id" ]]; then
      nb_api POST dcim/interfaces "$payload" > /dev/null
      echo "Created interface $ifName"
    else
      nb_api PATCH dcim/interfaces/$iface_id "$payload" > /dev/null
      echo "Updated interface $ifName"
    fi
  fi
done <<< "$INTERFACES"

# 3. Walk IPv4 addresses (IP-MIB::ipAddrTable)
echo "Walking IPv4 addresses..."
IPV4=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$DEVICE_IP" IP-MIB::ipAdEntAddr)
while IFS= read -r line; do
  # Example: IP-MIB::ipAdEntAddr.10.0.0.1 = IpAddress: 10.0.0.1
  if [[ $line =~ ^IP-MIB::ipAdEntAddr\.([0-9\.]+)\ =\ IpAddress:\ (.+)$ ]]; then
    ip=${BASH_REMATCH[2]}
    # Find the interface index for this IP
    idx_line=$(snmpget -v2c -c "$SNMP_COMMUNITY" "$DEVICE_IP" "IP-MIB::ipAdEntIfIndex.$ip" 2>/dev/null || true)
    if [[ $idx_line =~ ^IP-MIB::ipAdEntIfIndex\.([0-9\.]+)\ =\ INTEGER:\ ([0-9]+)$ ]]; then
      ifIndex=${BASH_REMATCH[2]}
      # Resolve interface name
      ifName=$(snmpget -v2c -c "$SNMP_COMMUNITY" "$DEVICE_IP" "IF-MIB::ifDescr.$ifIndex" 2>/dev/null | awk -F"STRING: " '{print $2}')
      # Create IP address in NetBox (assign to interface)
      payload=$(jq -n \
        --arg address "$ip/32" \
        --arg device_id "$DEVICE_ID" \
        --arg interface "$ifName" \
        '{address: $address, assigned_object_type: "dcim.interface", assigned_object_id: (null), status: "active"}')
      # Resolve interface ID for NetBox
      iface_id=$(nb_api GET dcim/interfaces "?device_id=$DEVICE_ID&name=$ifName" | jq -r '.results[0].id // empty')
      if [[ -n "$iface_id" ]]; then
        payload=$(echo "$payload" | jq ".assigned_object_id = ($iface_id|tonumber)")
        # Check if IP already exists
        ip_id=$(nb_api GET ipam/ip-addresses "?address=$ip" | jq -r '.results[0].id // empty')
        if [[ -z "$ip_id" ]]; then
          nb_api POST ipam/ip-addresses "$payload" > /dev/null
          echo "Created IPv4 $ip on $ifName"
        else
          nb_api PATCH ipam/ip-addresses/$ip_id "$payload" > /dev/null
          echo "Updated IPv4 $ip on $ifName"
        fi
      fi
    fi
  fi
done <<< "$IPV4"

# 4. Walk IPv6 addresses (IP-MIB::ipv6AddrTable)
echo "Walking IPv6 addresses..."
IPV6=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$DEVICE_IP" IPV6-MIB::ipv6AddrAddress)
while IFS= read -r line; do
  # Example: IPV6-MIB::ipv6AddrAddress.2001:db8::1 = IpAddress: 2001:db8::1
  if [[ $line =~ ^IPV6-MIB::ipv6AddrAddress\.([0-9A-Fa-f:]+)\ =\ IpAddress:\ (.+)$ ]]; then
    ip=${BASH_REMATCH[2]}
    # Resolve interface index for this IPv6 address
    idx_line=$(snmpget -v2c -c "$SNMP_COMMUNITY" "$DEVICE_IP" "IPV6-MIB::ipv6IfIndex.$ip" 2>/dev/null || true)
    if [[ $idx_line =~ ^IPV6-MIB::ipv6IfIndex\.([0-9A-Fa-f:]+)\ =\ INTEGER:\ ([0-9]+)$ ]]; then
      ifIndex=${BASH_REMATCH[2]}
      ifName=$(snmpget -v2c -c "$SNMP_COMMUNITY" "$DEVICE_IP" "IF-MIB::ifDescr.$ifIndex" 2>/dev/null | awk -F"STRING: " '{print $2}')
      payload=$(jq -n \
        --arg address "$ip/128" \
        --arg device_id "$DEVICE_ID" \
        --arg interface "$ifName" \
        '{address: $address, assigned_object_type: "dcim.interface", assigned_object_id: (null), status: "active"}')
      iface_id=$(nb_api GET dcim/interfaces "?device_id=$DEVICE_ID&name=$ifName" | jq -r '.results[0].id // empty')
      if [[ -n "$iface_id" ]]; then
        payload=$(echo "$payload" | jq ".assigned_object_id = ($iface_id|tonumber)")
        ip_id=$(nb_api GET ipam/ip-addresses "?address=$ip" | jq -r '.results[0].id // empty')
        if [[ -z "$ip_id" ]]; then
          nb_api POST ipam/ip-addresses "$payload" > /dev/null
          echo "Created IPv6 $ip on $ifName"
        else
          nb_api PATCH ipam/ip-addresses/$ip_id "$payload" > /dev/null
          echo "Updated IPv6 $ip on $ifName"
        fi
      fi
    fi
  fi
done <<< "$IPV6"

# 5. Serial number (ENTITY-MIB::entPhysicalSerialNum)
echo "Fetching serial number..."
SERIAL=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$DEVICE_IP" ENTITY-MIB::entPhysicalSerialNum | head -n1 | awk -F"STRING: " '{print $2}')
if [[ -n "$SERIAL" ]]; then
  payload=$(jq -n \
    --arg serial "$SERIAL" \
    '{serial: $serial}')
  nb_api PATCH dcim/devices/$DEVICE_ID "$payload" > /dev/null
  echo "Updated device serial number to $SERIAL"
fi

# 6. VRFs – many devices expose VRF via CISCO-VRF-MIB::ciscoVrfNameTable
# This is optional – if the MIB is not present the walk will be empty.
VRFS=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$DEVICE_IP" CISCO-VRF-MIB::ciscoVrfName)
if [[ -n "$VRFS" ]]; then
  echo "Processing VRFs..."
  while IFS= read -r line; do
    if [[ $line =~ ^CISCO-VRF-MIB::ciscoVrfName\.([0-9]+)\ =\ STRING:\ (.+)$ ]]; then
      vrf_id=${BASH_REMATCH[1]}
      vrf_name=${BASH_REMATCH[2]}
      # NetBox VRF endpoint: ipam/vrfs/
      payload=$(jq -n \
        --arg name "$vrf_name" \
        '{name: $name, rd: ""}')
      existing=$(nb_api GET ipam/vrfs "?name=$vrf_name" | jq -r '.results[0].id // empty')
      if [[ -z "$existing" ]]; then
        nb_api POST ipam/vrfs "$payload" > /dev/null
        echo "Created VRF $vrf_name"
      else
        nb_api PATCH ipam/vrfs/$existing "$payload" > /dev/null
        echo "Updated VRF $vrf_name"
      fi
    fi
done <<< "$VRFS"
fi
# 7. VLANs – discovered via Q-BRIDGE-MIB::dot1qVlanStaticName
VLANs=$(snmpwalk -v2c -c "$SNMP_COMMUNITY" "$DEVICE_IP" Q-BRIDGE-MIB::dot1qVlanStaticName)
if [[ -n "$VLANs" ]]; then
  echo "Processing VLANs..."
  while IFS= read -r line; do
    if [[ $line =~ ^Q-BRIDGE-MIB::dot1qVlanStaticName\.([0-9]+)\ =\ STRING:\ "?([^\"]+)"?$ ]]; then
      vlan_id=${BASH_REMATCH[1]}
      vlan_name=${BASH_REMATCH[2]}
      payload=$(jq -n \
        --arg name "$vlan_name" \
        --arg vid "$vlan_id" \
        '{name: $name, vid: ($vid|tonumber), status: "active"}')
      existing=$(nb_api GET ipam/vlans "?vid=$vlan_id" | jq -r '.results[0].id // empty')
      if [[ -z "$existing" ]]; then
        nb_api POST ipam/vlans "$payload" > /dev/null
        echo "Created VLAN $vlan_name (VID $vlan_id)"
      else
        nb_api PATCH ipam/vlans/$existing "$payload" > /dev/null
        echo "Updated VLAN $vlan_name (VID $vlan_id)"
      fi
    fi
  done <<< "$VLANs"
fi


echo "SNMP to NetBox population complete."
