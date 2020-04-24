# Cloud Sandbox

Cloud Sandbox deploys sandbox virtual machines and infrastructure on AWS for various usage via Ansible playbooks.

Current features:

- user-defined list of EC2 instances with:
  - DNS records attached to each instances public IP
  - Basic instance configuration (SSH daemon)

## Getting started


### Requirements:
- AWS account with proper rights on CloudFormation and services to use
- EC2 instances:
  - Existing keypair (to SSH into sandbox instances)
  - Existing VPC and Subnet 
- DNS record:
  - Route53 Hosted Zone
  - Domain name that you own
  - Proper configureation of (sub)domain name to use on the Route53 Host Zone NS servers

### Create your inventory

Configure at least the following variables:

```
# Environment name after which AWS resources will be named
cloud_sandbox_environment: "my-environment"

# VPC and subnet under which create AWS resources (i.e. EC2 instances)
cloud_sandbox_vpc_id: vpc-012345679910
cloud_sandbox_subnet_id: subnet-abcdefghijkl

# Existing key name to use to configure EC2 instance
cloud_sandbox_key_name: "key-name"

# Domain name under which create DNS records for instances
cloud_sandbox_domain_name: my.domain.org

# List of instances to create
# Each element is a string which will be used to define DNS record for instance based on cloud_sandbox_domain_name
# such as amelie.mydomain.org
cloud_sandbox_ec2_instances_names:
  - amelie
  - bob
```

You can use template inventory `inventories/template`. See roles defaults for additional variables.

### Creating and destroying sandbox

```
# Create/update
ansible-playbook -i inventories/template sandbox.yml

# Destroy by setting cloud_sandbox_state=absent
ansible-playbook -i inventories/template sandbox.yml -e cloud_sandbox_state=absent
```

Using previous example, sandbox EC2 instances would be available using:

```
# amelie
ssh -i key-name.pem ubuntu@amelie.my.domain.org

# bob
ssh -i key-name.pem ubuntu@bob.my.domain.org
```