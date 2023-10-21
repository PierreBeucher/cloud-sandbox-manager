# Sandbox instances
.PHONY: up
up: sandbox inventory playbook

.PHONY: sandbox
sandbox:
	pulumi -C pulumi/sandbox up -yrf

.PHONY: ansible
ansible: inventory playbook

.PHONY: inventory
inventory: 
	pulumi -C pulumi/sandbox stack output ansibleInventory > ansible/inventories/$(shell pulumi -C pulumi/sandbox stack --show-name).yml

.PHONY: playbook
playbook: 
	ansible-playbook ansible/playbook.yml -i ansible/inventories/$(shell pulumi -C pulumi/sandbox stack --show-name).yml

.PHONY: down
down:
	pulumi -C pulumi/sandbox destroy -yrf
	pulumi -C pulumi/eks destroy -yrf

# K8S
.PHONY: k8s
k8s: eks kubeconfig

.PHONY: eks
eks:
	pulumi -C pulumi/eks up -yfr

.PHONY: kubeconfig
kubeconfig: 
	pulumi -C pulumi/eks stack output kubeconfig --show-secrets > kubeconfig
	ansible-playbook ansible/eks-kubeconfig.yml -i ansible/inventories/$(shell pulumi -C pulumi/eks stack --show-name).yml

# Test
.PHONY: test
test:
	ansible-playbook test/test-docker.yml -i ansible/inventories/$(shell pulumi -C pulumi/sandbox stack --show-name).yml

.PHONY: test-k3s
test-k3s:
	ansible-playbook test/test-k3s.yml -i ansible/inventories/$(shell pulumi -C pulumi/sandbox stack --show-name).yml

.PHONY: test-eks
test-eks:
	ansible-playbook test/test-eks.yml -i ansible/inventories/$(shell pulumi -C pulumi/eks stack --show-name).yml

