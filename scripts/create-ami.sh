#!/usr/bin/env bash

#
# Create an AMI from an existing sandbox instance
#

set -e

echo "Deploying stack..."

# Deploy stack
pulumi -C pulumi/sandbox -s ${SANDBOX_ENVIRONMENT} up -yrf

# Set same AWS region as stack
aws_region="$(pulumi -C pulumi/sandbox -s ${SANDBOX_ENVIRONMENT} stack output awsRegionName)"

# Fetch the first instance stack
instance_id="$(pulumi -C pulumi/sandbox -s ${SANDBOX_ENVIRONMENT} stack output instances | jq .[0].instanceId -r)"
instance_ip="$(aws ec2 describe-instances --region ${aws_region} --instance-ids ${instance_id} | jq '.Reservations[0].Instances[0].PublicIpAddress' -r)"
instance_user="root"

echo "Using instance '$instance_id' with IP $instance_ip"

# Make sure host key is not saved as instance if freshly created
# Event if IP is known it won't match, that's expected
ssh-keygen -R ${instance_ip} || true

while ! ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${instance_user}@${instance_ip} true; do
    echo "Waiting for SSH connectivity to ${instance_ip}..."
    sleep 10
done

echo "SSH connection established."

# Wait for NixOS rebuild to finish
# Make sure no other nixos-rebuild is running and run it 

echo "Building and switching NixOS config... (may take some time)"

ssh ${instance_user}@${instance_ip} 'pkill nixos-rebuild || true; nixos-rebuild switch'

echo "Stopping instance before AMI creation..."

aws ec2 stop-instances --no-cli-pager --region "${aws_region}" --instance-ids "${instance_id}"
aws ec2 wait instance-stopped --region "${aws_region}" --instance-ids "${instance_id}"

echo "Creating AMI from EC2 instance..."

ami_name="crafteo-training-nixos-$(date +%Y-%m-%d-%H-%M-%S)"
create_image_result="$(aws ec2 create-image --region "${aws_region}" --instance-id "${instance_id}" --name ${ami_name})"
ami_id="$(echo $create_image_result | jq -r .ImageId)"

echo "Waiting for AMI $ami_name ($ami_id) to be ready..."

# Wait for AMI state to be "available"
while true; do
    ami_state=$(aws ec2 describe-images --region "${aws_region}" --image-ids "${ami_id}" | jq '.Images[0].State' -r)
    if [[ "$ami_state" == "available" ]]; then
        echo "AMI is available: ${ami_id}"
        break
    else
        echo "Waiting for AMI to be available... Current state: $ami_state"
        sleep 10
    fi
done

# Cleanup

echo "Cleaning-up Pulumi stack..."

pulumi -C pulumi/sandbox -s ${SANDBOX_ENVIRONMENT} destroy -yrf

echo
echo "✨ AMI is ready to be used: $ami_name ($ami_id)"