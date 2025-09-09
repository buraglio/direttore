#!/usr/bin/env python3

from nornir import InitNornir
from nornir_utils.plugins.tasks.data import load_yaml
from nornir_jinja2.plugins.tasks import template_file
from nornir_scrapli.tasks import send_configs
import git  # Requires GitPython

def git_commit(host, config):
    repo = git.Repo("/opt/network-configs")
    repo.index.add([f"{host}.conf"])
    repo.index.commit(f"Update {host} @ {datetime.now()}")

def deploy_config(task):
    config = task.run(
        task=template_file,
        template=f"{task.host.platform}/bgp.j2",
        jinja_env={"bgp_peers": task.host["bgp_peers"]}
    ).result
    task.run(task=send_configs, configs=config.splitlines())
    with open(f"/opt/network-configs/{task.host}.conf", "w") as f:
        f.write(config)
    git_commit(task.host.name, config)

nr = InitNornir("inventory.py")
nr.run(task=deploy_config, on_good=True)
