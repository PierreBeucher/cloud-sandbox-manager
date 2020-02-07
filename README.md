# Cloud Sandbox

Manage sandbox machines and infrastructure on AWS 

Cloud Sandbox provides an easy way to deploy sandbox virtual machines and infrastructure in on AWS for various usage via Ansible playbooks.

Currently support:

- 1 or more EC2 instances
- DNS records attached to each instance public IP

## Getting started

### Requirements

- AWS account with proper rights on CloudFormation and services to use
- EC2 instances:
  - Existing keypair (to SSH into sandbox instances)
  - Existing VPC and Subnet 
- DNS record:
  - Route53 Hosted Zone
  - Domain name that you own
  - Proper configureation of (sub)domain name to use on the Route53 Host Zone NS servers

Configure the following variables:

```
cloud_sandbox_vpc_id: vpc-0f9b02336e1541f62 # crafteo-sandbox-vpc
cloud_sandbox_subnet_id: subnet-01231059821fc3b96

cloud_sandbox_key_name: "mysandbox-keypair"

cloud_sandbox_route53_dns_record_suffix: mysandbox.foo.bar
cloud_sandbox_route53_hosted_zone_name: foo.bar.
```

See roles defaults for additional variables.

### Running sandbox

