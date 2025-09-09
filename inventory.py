#!/usr/bin/env python3

from nornir.core import InitNornir
from nornir_netbox.plugins.inventory import NBInventory

nr = InitNornir(
    inventory={
        "plugin": "NBInventory",
        "options": {
            "nb_url": "http://localhost:8000",
            "nb_token": "NETBOX_API_TOKEN",  # From NetBox *User → API Tokens*
        }
    }
)
