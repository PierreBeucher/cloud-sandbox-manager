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
	pulumi -C pulumi/sandbox -s ${SANDBOX_NAME} stack output ansibleInventory > ansible/inventories/$(shell pulumi -C pulumi/sandbox -s ${SANDBOX_NAME} stack --show-name).yml

.PHONY: playbook
playbook: 
	ansible-playbook ansible/playbook.yml -i ansible/inventories/$(shell pulumi -C pulumi/sandbox -s ${SANDBOX_NAME} stack --show-name).yml

.PHONY: down
down:
	pulumi -C pulumi/traefik -s ${SANDBOX_NAME} destroy -yrf
	pulumi -C pulumi/skooner -s ${SANDBOX_NAME} destroy -yrf
	pulumi -C pulumi/cluster-autoscaler -s ${SANDBOX_NAME} destroy -yrf
	pulumi -C pulumi/metrics-server -s ${SANDBOX_NAME} destroy -yrf
	pulumi -C pulumi/cert-manager -s ${SANDBOX_NAME} destroy -yrf
	pulumi -C pulumi/eks-config -s ${SANDBOX_NAME} destroy -yrf
	pulumi -C pulumi/eks -s ${SANDBOX_NAME} destroy -yrf
	pulumi -C pulumi/sandbox -s ${SANDBOX_NAME} destroy -yrf

# K8S
.PHONY: k8s
k8s: eks cluster-autoscaler traefik skooner cert-manager metrics-server kubeconfig

.PHONY: eks
eks: eks-cluster eks-config eks-ansible

.PHONY: eks-cluster
eks-cluster:
	pulumi -C pulumi/eks -s ${SANDBOX_NAME} up -yfr

.PHONY: eks-config
eks-config:
	pulumi -C pulumi/eks-config -s ${SANDBOX_NAME} up -yfr

.PHONY: eks-ansible
eks-ansible:
	ansible-playbook ansible/eks-kubeconfig.yml -i ansible/inventories/$(shell pulumi -C pulumi/sandbox -s ${SANDBOX_NAME} stack --show-name).yml

.PHONY: traefik
traefik:
	pulumi -C pulumi/traefik -s ${SANDBOX_NAME} up -yfr

.PHONY: cert-manager
cert-manager:
	pulumi -C pulumi/cert-manager -s ${SANDBOX_NAME} up -yfr

.PHONY: metrics-server
metrics-server:
	pulumi -C pulumi/metrics-server -s ${SANDBOX_NAME} up -yfr

.PHONY: cluster-autoscaler
cluster-autoscaler:
	pulumi -C pulumi/cluster-autoscaler -s ${SANDBOX_NAME} up -yfr

.PHONY: skooner
skooner:
	pulumi -C pulumi/skooner -s ${SANDBOX_NAME} up -yfr

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
	ansible-playbook test/test-docker.yml -i ansible/inventories/$(shell pulumi -C pulumi/sandbox -s ${SANDBOX_NAME} stack --show-name).yml

.PHONY: test-eks
test-eks:
	ansible-playbook test/test-eks.yml -i ansible/inventories/$(shell pulumi -C pulumi/eks -s ${SANDBOX_NAME} stack --show-name).yml

