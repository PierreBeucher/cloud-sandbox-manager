sandbox-create:
	ansible-playbook -i inventories/crafteo sandbox.yml

sandbox-remove:
	ansible-playbook -i inventories/crafteo sandbox.yml -e cloud_sandbox_state=absent