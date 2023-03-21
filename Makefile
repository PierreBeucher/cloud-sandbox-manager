up:
	pulumi -C pulumi -s sandbox up -yrf
	ansible-playbook sandbox.yml -i inventories/sandbox

down:
	pulumi -C pulumi -s sandbox destroy -yrf