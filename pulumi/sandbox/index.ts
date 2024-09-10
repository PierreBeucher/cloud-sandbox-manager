import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as nixConfig from './configuration.nix'
import * as yaml from "js-yaml"

interface SandboxInstanceConfig {
    name: string,   // instance name (used as hostname prefix)
    eipalloc?: string    // optionally existing EIP allocation ID for instance, if not specified a new one is created
}

const config = new pulumi.Config();
const environment = config.require("environment")
const sshPublicKey = config.require("sshPublicKey")
const hostedZoneName = config.require("hostedZoneName")
const instanceAmi = config.require("instanceAmi")
const instanceType = config.require("instanceType")
const instances = config.requireObject<SandboxInstanceConfig[]>("instances")
const sandboxUser = config.require("user")
const sandboxUserHashedPassword = config.require("hashedPassword")

const codeServerEnabled = config.getBoolean("codeServerEnabled") || false
const codeServerHashedPassword = config.get("codeServerHashedPassword") || ""

const commonTags = { 
    Controller: `cloud-sandbox-${environment}`,
}


const vpcCidr = "192.168.0.0/24"

// VPC
const vpc = new aws.ec2.Vpc("vpc", {
    cidrBlock: vpcCidr,
});

const subnet = new aws.ec2.Subnet("subnet", {
    vpcId: vpc.id,
    cidrBlock: vpcCidr,
});

const gateway = new aws.ec2.InternetGateway("IGW", {
    vpcId: vpc.id,
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

const routeTableAssociation = new aws.ec2.RouteTableAssociation("rt-assoc", {
    subnetId: subnet.id,
    routeTableId: routeTable.id,
});

// IAM

const awsCallerId = pulumi.output(aws.getCallerIdentity())
const awsRegion = aws.getRegionOutput()

// Allow read-only for Sandbox clusters
const eksReadOnlyPolicy = new aws.iam.Policy("eks-readonly-policy", {
    policy: pulumi.jsonStringify({
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "DescribeCluster",
                "Effect": "Allow",
                "Action": [
                    "eks:DescribeCluster"
                ],
                "Resource": pulumi.interpolate`arn:aws:eks:${awsRegion.name}:${awsCallerId.accountId}:cluster/cloud-sandbox-${environment}` // same name as eks stack
            },
            {
                "Sid": "ListClusters",
                "Effect": "Allow",
                "Action": [
                    "eks:ListClusters"
                ],
                "Resource": "*"
            }
        ]
    })
})

const iamRole = new aws.iam.Role("sandbox-iam-role", {
    name: `cloud-sandox-instance-${environment}`,
    assumeRolePolicy: {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": { "Service": "ec2.amazonaws.com"},
                "Action": "sts:AssumeRole"
            }
        ]
    },
    tags: commonTags   
})

new aws.iam.RolePolicyAttachment("sandbox-eks-readonly-pa", {
    policyArn: eksReadOnlyPolicy.arn,
    role: iamRole
})

const instanceProfile = new aws.iam.InstanceProfile("sandbox-iam-instance-profile", {
    role: iamRole.name
});

// Instance
const hostedZone = aws.route53.getZone({ name: hostedZoneName })

const keyPair = new aws.ec2.KeyPair("key-pair", {
    publicKey: sshPublicKey,
    keyName: `cloud-sandbox-${environment}`,
    tags: commonTags
})

const sg = new aws.ec2.SecurityGroup(`security-group`, {
    vpcId: vpc.id,
    ingress: [
        // Allow all on internal network
        { fromPort: 0, toPort: 65535, protocol: "tcp", cidrBlocks: [vpcCidr]},

        // SSH HTTP(S)
        { fromPort: 22, toPort: 22, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"]},
        { fromPort: 80, toPort: 80, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
        { fromPort: 443, toPort: 443, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },

        // Various apps for training
        { fromPort: 5000, toPort: 5100, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
        { fromPort: 3000, toPort: 3000, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
        { fromPort: 8080, toPort: 8190, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
        { fromPort: 9090, toPort: 9099, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
    ],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"],
    }],
    tags: {
        ...commonTags,
        Name: `Sandbox ${environment}`
    }
});

let instanceOutputs : { 
    fqdn: pulumi.Output<string>, 
    publicIp: pulumi.Output<string>,
    instanceId: pulumi.Output<string> 
}[] = []

for(const instance of instances) {
    
    const instanceName = instance.name
    const instanceExistingEip = instance.eipalloc

    const fqdn = `${instanceName}.${hostedZoneName}`

    const ec2Instance = new aws.ec2.Instance(`instance-${instanceName}`, {
        ami: instanceAmi,
        instanceType: instanceType,
        iamInstanceProfile: instanceProfile,
        tags: {
            ...commonTags,
            Name: `Sandbox ${fqdn}`
        },
        
        volumeTags: commonTags,
        rootBlockDevice: {
            volumeSize: 100
        },
        creditSpecification: {
            cpuCredits: "unlimited"
        },
        vpcSecurityGroupIds: [sg.id],
        subnetId: subnet.id,
        keyName: keyPair.keyName,
        userData: nixConfig.getConfigurationNix({ 
            hostname: instanceName, 
            user: sandboxUser,
            sshPublicKeys: [ sshPublicKey ],
            hashedPassword: sandboxUserHashedPassword,
            codeServer: {
                enabled: codeServerEnabled,
                hashedPassword: codeServerHashedPassword
            },
        })
    })
    
    const eip = instanceExistingEip ? 
        aws.ec2.Eip.get(`eip-${instanceName}`, instanceExistingEip)
    :
        new aws.ec2.Eip(`eip-${instanceName}`, {
            tags: {
                ...commonTags,
                Name: `Sandbox ${fqdn}`
            }
        })
    
    const eipAssoc = new aws.ec2.EipAssociation(`eip-assoc-${instanceName}`, {
        instanceId: ec2Instance.id,
        allocationId: eip.id,
    });
    
    // DNS record using Elastic IP
    const dnsRecord = new aws.route53.Record(`dns-record-${instanceName}`, {
        zoneId: hostedZone.then(hz => hz.id),
        name: fqdn,
        type: "A",
        ttl: 30,
        records: [ eip.publicIp],
    });
    
    const wilddcarDnsRecord = new aws.route53.Record(`wildcard-dns-record-${instanceName}`, {
        zoneId: hostedZone.then(hz => hz.id),
        name: `*.${fqdn}`,
        type: "A",
        ttl: 30,
        records: [ eip.publicIp ]
    });

    instanceOutputs.push({
        fqdn: pulumi.output(fqdn),
        publicIp: eip.publicIp,
        instanceId: ec2Instance.id
    })   
}

export const outputs = instanceOutputs

// Set Ansible inventory as output to easily write it from stack outputs
const ansibleHosts = instanceOutputs.map(h => h.publicIp)
const instanceIds = outputs.map(o => o.instanceId)

export const ansibleInventory = pulumi.all([ansibleHosts, instanceIds, awsRegion.name]).apply(([hosts, instIds, awsRegionName]) => yaml.dump({
    all: {
        hosts: Object.fromEntries(hosts.map(h => [h, null])),
        vars: {
            sandbox_environment: environment,
            ansible_ssh_common_args: "-o StrictHostKeyChecking=no",
            sandbox_user: sandboxUser,
            instance_ids: instIds,
            aws_region: awsRegionName
        }
    }
}))