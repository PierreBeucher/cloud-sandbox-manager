.PHONY: select
select:
	pulumi -C pulumi stack select

.PHONY: pulumi
pulumi:
	pulumi -C pulumi up -yrf

.PHONY: ansible
ansible: inventory playbook

.PHONY: inventory
inventory: 
	pulumi -C pulumi stack output ansibleInventory > ansible/inventories/$(shell pulumi -C pulumi stack --show-name).yml

.PHONY: playbook
playbook: 
	ansible-playbook ansible/playbook.yml -i ansible/inventories/$(shell pulumi -C pulumi stack --show-name).yml

up: select pulumi inventory playbook

.PHONY: down
down:
	pulumi -C pulumi destroy -yrf

.PHONY: test
test:
	ansible-playbook test/test-docker.yml -i ansible/inventories/$(shell pulumi -C pulumi stack --show-name).yml