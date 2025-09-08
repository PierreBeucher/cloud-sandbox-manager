import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/**
 * Get all hosts IP addresses from a CIDR block in form 192.168.0.0/24.
 * Inspired from https://stackoverflow.com/questions/22927298/create-ip-range-from-start-and-end-point-in-javascript-or-jquery
 */
export function getCidrHostIps(cidrBlock: string): string[] {

    const ipParts = cidrBlock.split("/")[0].split(".")

    // Number of host IPs available with mask
    const ipMask = parseInt(cidrBlock.split("/")[1], 10)
    const maxIpCount = Math.pow(2, 32-ipMask)-2

    // convert IP parts to hex
    const ipPart1 = parseInt(ipParts[0], 10).toString(16).padStart(2, '0')
    const ipPart2 = parseInt(ipParts[1], 10).toString(16).padStart(2, '0')
    const ipPart3 = parseInt(ipParts[2], 10).toString(16).padStart(2, '0')
    const ipPart4 = parseInt(ipParts[3], 10).toString(16).padStart(2, '0')

    const ipRangeStart = parseInt(`${ipPart1}${ipPart2}${ipPart3}${ipPart4}`, 16) + 1
    const ipRangeEnd = ipRangeStart + maxIpCount

    let result : string[] = []
    for (let i=ipRangeStart; i<ipRangeEnd; i++){
        const ipHex = parseInt(i.toString(16), 16)

        const ip1 = (ipHex >> 24) & 0xff
        const ip2 = (ipHex >> 16) & 0xff
        const ip3 = (ipHex >> 8) & 0xff
        const ip4 = ipHex & 0xff

        result.push(`${ip1}.${ip2}.${ip3}.${ip4}`)
    }

    return result
}

/**
 * Retrieve kubeconfig from sandbox eks stack and generate a Kubernetes provider
 */
export function getKubernetesProvider(){
    const eksStack = getPulumiStackRef("cloud-sandbox-eks", pulumi.getStack())
    const kubeconfig = pulumi.output(eksStack.getOutputValue("kubeconfig") as Promise<string>)
    return new k8s.Provider("k8s-provider", {
        kubeconfig: kubeconfig
    })
}

/**
 * Get the Sandbox Pulumi stack with given name and environment.
 */
export function getPulumiStackRef(name: string, environment: string): pulumi.StackReference {
    const org = pulumi.getOrganization()

    return new pulumi.StackReference(`${name}-stackref`, {
        name: `${org}/${name}/${environment}`
    })
}