import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import * as tls from "@pulumi/tls";
import * as k8s from "@pulumi/kubernetes";
import { ServiceAccount } from "../components/service-account"

const awsConfig = new pulumi.Config("aws");
const awsRegion = awsConfig.require("region")

const config = new pulumi.Config();
const environment = config.require("environment")
const adminIamRoles = config.getObject<string[]>("adminIamRoles") ?? []
const nodegroupSize = config.getNumber("nodegroupSize") ?? 2
const extraNodeSecurityGroupRules = config.getObject<Omit<aws.ec2.SecurityGroupRuleArgs, "securityGroupId">[]>("extraNodeSecurityGroupRules") ?? []

const commonTags = { 
    Name: `cloud-sandbox-${environment}-eks`,
}

const vpcCidr = "192.168.1.0/24"
const subnetACidr = "192.168.1.0/25"
const subnetBCidr = "192.168.1.128/25"

// VPC
const vpc = new aws.ec2.Vpc("vpc", {
    cidrBlock: vpcCidr,
    tags: commonTags,
});

const subnet_a = new aws.ec2.Subnet("subnet-a", {
    vpcId: vpc.id,
    cidrBlock: subnetACidr,
    mapPublicIpOnLaunch: true,
    availabilityZone: `${awsRegion}a`,
    tags: commonTags,
});

const subnet_b = new aws.ec2.Subnet("subnet-b", {
    vpcId: vpc.id,
    cidrBlock: subnetBCidr,
    mapPublicIpOnLaunch: true,
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
    tags: commonTags
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

// IAM Role for managed nodegroups
const nodegroupRole = new aws.iam.Role("managed-nodegroup-role", {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: "ec2.amazonaws.com",
    }),
    tags: commonTags
});

const clusterName = `cloud-sandbox-${environment}`
const cluster = new eks.Cluster("eks-cluster", {
    name: clusterName,
    vpcId: vpc.id,
    subnetIds: [ subnet_a.id, subnet_b.id ],
    roleMappings: clusterRoleMappings,
    tags: commonTags,
    skipDefaultNodeGroup: true,
    instanceRole: nodegroupRole,
    // nodeGroupOptions: {
    //     extraNodeSecurityGroups: [ nodeSecurityGroup ]
    //     // autoScalingGroupTags: {
    //     //     // Required for CLuster Autoscaler auto discovery
    //     //     // Tags looked-up for by defauly by Cluster Autoscaler Helm charts
    //     //     "k8s.io/cluster-autoscaler/enabled": "true",
    //     //     [`k8s.io/cluster-autoscaler/${clusterName}`]: "true",
    //     // }
    // }
})

// Nodegroups with custom launch template
// to affect security groups

const nodegroupRolePolicyArns = [
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
];

for (const policyArn of nodegroupRolePolicyArns) {
    new aws.iam.RolePolicyAttachment(`nodeGroupPolicy-${policyArn.split("/")[1]}`, {
        policyArn,
        role: nodegroupRole,
    });
}

const nodeSecurityGroup = new aws.ec2.SecurityGroup("node-security-group", {
    name: `cloud-sandbox-${environment}-eks-nodegroup-custom`,
    vpcId: vpc.id,
    tags: commonTags,
})

for (const rule of extraNodeSecurityGroupRules) {
    new aws.ec2.SecurityGroupRule(`security-group`, {
        ...rule,
        securityGroupId: nodeSecurityGroup.id,
    });
}

const nodegroupLaunchTemplate = new aws.ec2.LaunchTemplate("launchTemplate", {
    namePrefix: `cloud-sandbox-${environment}-eks-launch-template`,
    vpcSecurityGroupIds: [
        cluster.eksCluster.vpcConfig.clusterSecurityGroupId, // this SG should be on all node to talk with control plane
        nodeSecurityGroup.id
    ],
    tagSpecifications: [
        {
            resourceType: "instance",
            tags: {
                Name: `cloud-sandbox-${environment}-eks-node`,
            },
        },
        {
            resourceType: "volume",
            tags: {
                Name: `cloud-sandbox-${environment}-eks-node`,
            },
        },
    ]
})

cluster.eksCluster.vpcConfig.clusterSecurityGroupId.apply(id => pulumi.log.info(`cluster.eksCluster.vpcConfig.clusterSecurityGroupId: ${id}`))

const nodegroupCommonArgs: eks.ManagedNodeGroupOptions = {
    cluster: cluster,
    nodeRole: nodegroupRole,
    instanceTypes: [ "t3.large" ],
    scalingConfig: {
        minSize: 0,
        maxSize: 5,
        desiredSize: 1
    },
    tags: commonTags,
    launchTemplate: {
        id: nodegroupLaunchTemplate.id,
        version: nodegroupLaunchTemplate.latestVersion.apply(v => v.toString()),
    }
}

new eks.ManagedNodeGroup("nodegroup-zone-a", {
    ...nodegroupCommonArgs,
    subnetIds: [ subnet_a.id ],
})

const ng_b = new eks.ManagedNodeGroup("nodegroup-zone-b", {
    ...nodegroupCommonArgs,
    subnetIds: [ subnet_b.id ],
})

const clusterCertificate = cluster.eksCluster.identities.apply(identities => tls.getCertificateOutput({
    url: identities[0].oidcs?.[0]?.issuer,
}));

const oidcProvider = new aws.iam.OpenIdConnectProvider("eks-oidc-provider", {
    clientIdLists: ["sts.amazonaws.com"],
    thumbprintLists: [clusterCertificate.certificates[0].sha1Fingerprint], 
    url: cluster.eksCluster.identities[0].oidcs[0].issuer
});

const oidcProviderUrl = oidcProvider.url.apply(url => url.replace("https://", ""))

export const kubeconfig = cluster.kubeconfig
export { clusterName, oidcProviderUrl }
export const oidcProviderArn = oidcProvider.arn