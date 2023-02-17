up:
	ansible-playbook -e "@sandbox-config.yml" sandbox.yml

down:
	ansible-playbook -e "@sandbox-config.yml" sandbox-destroy.yml

deps:
	ansible-galaxy install -r requirements.yml
	pip install -r requirements.txt