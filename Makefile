sandbox-create:
	ansible-playbook -i inventories/crafteo-training sandbox.yml

sandbox-remove:
	ansible-playbook -i inventories/crafteo-training sandbox.yml -e cloud_sandbox_state=absent