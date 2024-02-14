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
	pulumi -C pulumi/traefik destroy -yrf
	pulumi -C pulumi/skooner destroy -yrf
	pulumi -C pulumi/eks destroy -yrf

# K8S
.PHONY: k8s
k8s: eks traefik skooner kubeconfig

.PHONY: eks
eks:
	pulumi -C pulumi/eks up -yfr

.PHONY: traefik
traefik:
	pulumi -C pulumi/traefik up -yfr

.PHONY: skooner
skooner:
	pulumi -C pulumi/skooner up -yfr

.PHONY: kubeconfig
kubeconfig: 
	aws eks update-kubeconfig --name cloud-sandbox-${SANDBOX_NAME}

.PHONY: users-config
users-config:
	kubectl -n skooner create token skooner-sa > users-config/skooner-token
	cat users-config/skooner-token | kubectl view-serviceaccount-kubeconfig > users-config/kubeconfig
	
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

