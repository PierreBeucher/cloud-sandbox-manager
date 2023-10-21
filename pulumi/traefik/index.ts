import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { getKubernetesProvider } from "../utils"

const config = new pulumi.Config();
const environment = config.require("environment")
const hostedZoneName = config.require("hostedZoneName")

const k8sProvider = getKubernetesProvider()

const commonTags = { 
    Name: `cloud-sandbox-${environment}`,
}

// Traefik
const traefikNamespaceName  = "traefik"
const traefikNamespace = new k8s.core.v1.Namespace("traefik-namespace", {
    metadata: {
        name: traefikNamespaceName
    }
}, {
    provider: k8sProvider
})

const traefikRelease = new k8s.helm.v3.Release("traefik", {
    chart: "traefik",
    repositoryOpts: {
        repo: "https://helm.traefik.io/traefik",
    },
    namespace: traefikNamespaceName,
    values: {},
}, {
    provider: k8sProvider,
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
        provider: k8sProvider,
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