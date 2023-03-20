import * as aws from "@pulumi/aws";
import { Environment } from "@pulumi/aws/appconfig";
import { TagOptionResourceAssociation } from "@pulumi/aws/servicecatalog";
import * as pulumi from "@pulumi/pulumi";
import { type } from "os";

const config = new pulumi.Config();
const environment = config.require("environment")
const sshPublicKey = config.require("sshPublicKey")
const hostedZoneName = config.require("hostedZoneName")
const instanceAmi = config.require("instanceAmi")
const instanceType = config.require("instanceType")
const instances = config.requireObject<string[]>("instances")

const commonTags = { 
    Controller: `cloud-sandbox-${environment}`,
}

const hostedZone = aws.route53.getZone({ name: hostedZoneName })

const keyPair = new aws.ec2.KeyPair("keyPair", {
    publicKey: sshPublicKey,
    keyName: `cloud-sandbox-${environment}`,
    tags: commonTags
})

const sg = new aws.ec2.SecurityGroup(`securityGroup`, {
    ingress: [
        // SSH HTTP(S)
        { fromPort: 22, toPort: 22, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"]},
        { fromPort: 80, toPort: 80, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
        { fromPort: 443, toPort: 443, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },

        // Various apps for training
        { fromPort: 5000, toPort: 5100, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
        { fromPort: 3000, toPort: 3000, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
        { fromPort: 8080, toPort: 8190, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
        
        // K3S - see https://docs.k3s.io/installation/requirements#inbound-rules-for-k3s-server-nodes
        { fromPort: 6443, toPort: 6443, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
        { fromPort: 51820, toPort: 51821, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
        { fromPort: 10250, toPort: 10250, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
        { fromPort: 2380, toPort: 2380, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
        { fromPort: 4872, toPort: 4872, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },
        { fromPort: 31000, toPort: 31100, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"] },    
    ],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"],
    }],
    tags: commonTags,
});

instances.forEach(name => {

    const fqdn = `${name}.${hostedZoneName}`

    const ec2Instance = new aws.ec2.Instance(`ec2Instance-${name}`, {
        ami: instanceAmi,
        instanceType: instanceType,
        tags: commonTags,
        volumeTags: commonTags,
        vpcSecurityGroupIds: [sg.id],
        keyName: keyPair.keyName
    });
    
    const eip = new aws.ec2.Eip(`eip-${name}`, {
        tags: commonTags
    });
    
    const eipAssoc = new aws.ec2.EipAssociation(`eipAssoc-${name}`, {
        instanceId: ec2Instance.id,
        allocationId: eip.id,
    });
    
    // DNS record using Elastic IP
    const dnsRecord = new aws.route53.Record(`dns-record-${name}`, {
        zoneId: hostedZone.then(hz => hz.id),
        name: fqdn,
        type: "A",
        ttl: 30,
        records: [ eip.publicIp],
    });
    
    const wilddcarDnsRecord = new aws.route53.Record(`wildcard-dns-record-${name}`, {
        zoneId: hostedZone.then(hz => hz.id),
        name: `*.${fqdn}`,
        type: "A",
        ttl: 30,
        records: [ eip.publicIp ]
    });    
})

