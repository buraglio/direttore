# Install dependencies
sudo apt install -y postgresql libpq-dev redis-server python3-venv

# Clone NetBox
git clone -b v3.7 https://github.com/netbox-community/netbox.git
cd netbox

# Configure secrets (edit netbox/netbox/configuration.py)
SECRET_KEY = "your_50_char_random_string_here"  # Use `pwgen -s 50 1`
REDIS = {"tasks": {"HOST": "127.0.0.1"}}

# Initialize
./upgrade.sh

# Start services
sudo systemctl start netbox netbox-rq
