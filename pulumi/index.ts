import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as nixConfig from './configuration.nix'
import * as yaml from "js-yaml"
import * as utils from "./utils"
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const environment = config.require("environment")
const sshPublicKey = config.require("sshPublicKey")
const hostedZoneName = config.require("hostedZoneName")
const instanceAmi = config.require("instanceAmi")
const instanceType = config.require("instanceType")
const instances = config.requireObject<string[]>("instances")
const sandboxUser = config.require("user")
const sandboxUserHashedPassword = config.require("hashedPassword")

const codeServerEnabled = config.getBoolean("codeServerEnabled") || false
const codeServerHashedPassword = config.get("codeServerHashedPassword") || ""

const commonTags = { 
    Controller: `cloud-sandbox-${environment}`,
}


const vpcCidr = "192.168.0.0/24"

// All instances are created within VPC
// We want instance private IP to remain the same over time using IPs in this array
// Remove first 3 and last IPs as they're reserved, see https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html
const allVpcHostIps = utils.getCidrHostIps(vpcCidr).slice(3, -1)

// k3s
const k3sEnabled = config.getBoolean("k3sEnabled") || false
const k3sServerInternalIp = allVpcHostIps[0] // k3s server is always first machine in list
const k3sServerInternalAddr = `https://${k3sServerInternalIp}:6443`

// Random k3s token created at stack creation, do not change during stack life
const k3sToken = new random.RandomPassword("k3s-token", {
    length: 30,
    special: false
})

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
        { fromPort: 30000, toPort: 32767, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] }, // k3s NodePort services
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

let instanceOutputs : { fqdn: string }[] = []

for (let i=0; i<instances.length; i++) {
    const instanceName = instances[i]
    const instanceIp = allVpcHostIps[i]
    const isK3sServer = instanceIp == k3sServerInternalIp

    const fqdn = `${instanceName}.${hostedZoneName}`

    const ec2Instance = k3sToken.result.apply(k3sTokenResult =>
        new aws.ec2.Instance(`instance-${instanceName}`, {
            ami: instanceAmi,
            instanceType: instanceType,
            tags: {
                ...commonTags,
                Name: `Sandbox ${fqdn}`
            },
            volumeTags: commonTags,
            rootBlockDevice: {
                volumeSize: 100
            },
            vpcSecurityGroupIds: [sg.id],
            subnetId: subnet.id,
            privateIp: instanceIp,
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
                k3s: {
                    enabled: k3sEnabled,
                    role: isK3sServer ? "server" : "agent",
                    // only specify server addr for non-server instance, otherwise server fails to start
                    serverAddr: isK3sServer ? "" : k3sServerInternalAddr, 
                    token: k3sTokenResult
                }
            })
        })
    )
    
    const eip = new aws.ec2.Eip(`eip-${instanceName}`, {
        tags: {
            ...commonTags,
            Name: `Sandbox ${fqdn}`
        }
    });
    
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
        fqdn: fqdn,
    })   
}

export const access =  instanceOutputs.map(o => {
    return {
        fqdn: o.fqdn,
        ssh: `ssh linux@${o.fqdn}`,
        url: `https://${o.fqdn}:8080`
    }
})

export const outputs = JSON.stringify(instanceOutputs)

// Set Ansible inventory as output to easily write it from stack outputs
let hosts: {[key:string]: any} = {};
instanceOutputs.map(h => {
    hosts[h.fqdn] = null
})

const k3sServerHostname = instanceOutputs[0].fqdn

export const ansibleInventory = yaml.dump({
    all: {
        hosts: hosts,
        vars: {
            ansible_ssh_common_args: "-o StrictHostKeyChecking=no",
            sandbox_user: sandboxUser,
            k3s_enabled: k3sEnabled,
            k3s_server_hostname: k3sServerHostname,
            k3s_server_internal_address: k3sServerInternalAddr
        }
    }
})