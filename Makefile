.PHONY: select
select:
    # Will prompt is SANDBOX_NAME is unset
	pulumi -C pulumi stack select ${SANDBOX_NAME} -c

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

.PHONY: test-k3s
test-k3s:
	ansible-playbook test/test-k3s.yml -i ansible/inventories/$(shell pulumi -C pulumi stack --show-name).yml