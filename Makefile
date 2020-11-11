deploy:
	ansible-playbook -i inventories/crafteo sandbox.yml

delete:
	ansible-playbook -i inventories/crafteo sandbox.yml -e cloud_sandbox_state=absent
