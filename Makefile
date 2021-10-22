up:
	ansible-playbook -e "@sandbox-config.yml" sandbox.yml

down:
	ansible-playbook -e "@sandbox-config.yml" sandbox-destroy.yml
