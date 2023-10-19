import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import { Skooner } from "./skooner"

const awsConfig = new pulumi.Config("aws");
const awsRegion = awsConfig.require("region")

const config = new pulumi.Config();
const environment = config.require("environment")
const hostedZoneName = config.require("hostedZoneName")

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
const cluster = new eks.Cluster("eks-cluster", {
    name: `cloud-sandbox-${environment}`,
    desiredCapacity: 2,
    minSize: 1,
    maxSize: 2,
    vpcId: vpc.id,
    subnetIds: [ subnet_a.id, subnet_b.id ],
    tags: commonTags
});

// Traefik
const traefikNamespaceName  = "traefik"
const traefikNamespace = new k8s.core.v1.Namespace("traefik-namespace", {
    metadata: {
        name: traefikNamespaceName
    }
}, {
    provider: cluster.provider
})


const traefikRelease = new k8s.helm.v3.Release("traefik", {
    chart: "traefik",
    repositoryOpts: {
        repo: "https://helm.traefik.io/traefik",
    },
    namespace: traefikNamespaceName,
    values: {},
}, {
    provider: cluster.provider,
    deleteBeforeReplace: true,
    dependsOn: [ traefikNamespace ]
})

// Extract Traefik LB service hostname
// Pulumi Service.get waits for service to be ready, 
// in our case Load Balancer should exists with proper A record
const traefikService = k8s.core.v1.Service.get(
    "traefik-service",
    pulumi.interpolate `${traefikNamespaceName}/${traefikRelease.status.name}`,
    { 
        provider: cluster.provider,
        dependsOn: traefikRelease
    }
)

traefikService.status.loadBalancer.ingress[0].hostname.apply(lbHostname => {
    pulumi.log.info(`Traefik LB: ${lbHostname}`)

    const loadBalancerHostedZone = aws.elb.getHostedZoneIdOutput({});

    const hz = aws.route53.getZoneOutput({
        name: hostedZoneName
    })

    const traefikLbRecord = new aws.route53.Record("traefik-lb-dns-record", {
        zoneId: hz.id,
        name: hostedZoneName,
        type: "A",
        aliases: [{
            zoneId: loadBalancerHostedZone.id,
            name: lbHostname,
            evaluateTargetHealth: true
        }],
    })

    const traefikLbRecordWildcard = new aws.route53.Record("traefik-lb-dns-record-wildcard", {
        zoneId: hz.id,
        name: `*.${hostedZoneName}`,
        type: "A",
        aliases: [{
            zoneId: loadBalancerHostedZone.id,
            name: lbHostname,
            evaluateTargetHealth: true
        }],
    })
})


const skooner = new Skooner("skooner",  {
    fqdn: `skooner.${hostedZoneName}`,
    namespace: "skooner"
}, {
    provider: cluster.provider
})

// Export cluster kubeconfig
export const kubeconfig = cluster.kubeconfig;
