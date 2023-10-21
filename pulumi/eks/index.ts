import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import { ServiceAccount } from "../components/service-account"

const awsConfig = new pulumi.Config("aws");
const awsRegion = awsConfig.require("region")

const config = new pulumi.Config();
const environment = config.require("environment")
const adminIamRoles = config.getObject<string[]>("adminIamRoles") || []

const commonTags = { 
    Name: `cloud-sandbox-${environment}`,
}

const vpcCidr = "192.168.1.0/24"
const subnetACidr = "192.168.1.0/25"
const subnetBCidr = "192.168.1.128/25"

// VPC
const vpc = new aws.ec2.Vpc("vpc", {
    cidrBlock: vpcCidr,
    tags: commonTags
});

const subnet_a = new aws.ec2.Subnet("subnet-a", {
    vpcId: vpc.id,
    cidrBlock: subnetACidr,
    availabilityZone: `${awsRegion}a`,
    tags: commonTags
});

const subnet_b = new aws.ec2.Subnet("subnet-b", {
    vpcId: vpc.id,
    cidrBlock: subnetBCidr,
    availabilityZone: `${awsRegion}b`,
    tags: commonTags
});

const gateway = new aws.ec2.InternetGateway("IGW", {
    vpcId: vpc.id,
    tags: commonTags
});

const routeTable = new aws.ec2.RouteTable("rt", {
    vpcId: vpc.id,
    routes: [
        {
            cidrBlock: "0.0.0.0/0",
            gatewayId: gateway.id,
        },
    ],
});

const rta_a = new aws.ec2.RouteTableAssociation("rt-assoc-a", {
    subnetId: subnet_a.id,
    routeTableId: routeTable.id,
});

const rta_b = new aws.ec2.RouteTableAssociation("rt-assoc-b", {
    subnetId: subnet_b.id,
    routeTableId: routeTable.id,
});

// Cluster
const clusterRoleMappings = adminIamRoles.map(roleName => {
    
    const role = aws.iam.getRoleOutput({ name: roleName})

    return {
        groups: ["system:masters"],
        roleArn: role.arn,
        username: roleName
    }
})

const cluster = new eks.Cluster("eks-cluster", {
    name: `cloud-sandbox-${environment}`,
    desiredCapacity: 2,
    minSize: 1,
    maxSize: 2,
    vpcId: vpc.id,
    subnetIds: [ subnet_a.id, subnet_b.id ],
    roleMappings: clusterRoleMappings,
    tags: commonTags
});

// SA to allow admin access from sandbox instances
const sandboxServiceAccount = new ServiceAccount("sandbox-sa", {
    namespace: "kube-system"
}, {
    provider: cluster.provider
})

export const kubeconfig = cluster.kubeconfig;