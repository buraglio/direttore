sed -i.bak 's/name: \$name, device: (\$device_id|tonumber)/name: $name, device: ($device_id|tonumber), type: "other"/' snmp_to_netbox.sh
