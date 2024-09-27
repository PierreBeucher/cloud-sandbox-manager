import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { getKubernetesProvider } from "../utils"

const config = new pulumi.Config();
const environment = config.require("environment")

const k8sProvider = getKubernetesProvider()

const metricsServerNamespaceName  = "kube-system"

const metricsServerRelease = new k8s.helm.v3.Release("metrics-server", {
    name: "metrics-server",
    chart: "metrics-server",
    repositoryOpts: {
        repo: "https://kubernetes-sigs.github.io/metrics-server/",
    },
    namespace: metricsServerNamespaceName,
    values: {},
}, {
    provider: k8sProvider,
})