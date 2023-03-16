up:
	ansible-playbook sandbox.yml -i inventories/crafteo

down:
	ansible-playbook sandbox-destroy.yml -i inventories/crafteo

deps:
	ansible-galaxy install -r requirements.yml
	pip install -r requirements.txt