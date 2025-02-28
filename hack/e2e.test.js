/* eslint-disable */
const test = require("ava");
const fs = require("fs").promises;
const path = require("path");
const { spawn, execSync } = require("child_process");
const k8s = require("@kubernetes/client-node");

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const k8sApi = kc.makeApiClient(k8s.AppsV1Api);
const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);

// Timeout in milliseconds
const TIMEOUT = 120 * 1000;
const testDir = "pepr-test-module";

let expectedLines = [
  "Establishing connection to Kubernetes",
  "Capability hello-pepr registered",
  "hello-pepr: V1ConfigMap Binding created",
  "hello-pepr: V1ConfigMap Binding action created",
  "Server listening on port 3000",
  "Using beforeHook: req => pepr_1.Log.debug(`beforeHook: ${req.uid}`)",
  "Using afterHook: res => pepr_1.Log.debug(`afterHook: ${res.uid}`)",
];

function stripAnsiCodes(input) {
  return input.replace(/\u001B\[[0-9;]*[a-zA-Z]/g, "");
}

test.before(async t => {
  const dir = path.resolve(testDir);

  try {
    await fs.access(dir);
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err;
      // The directory does not exist, do nothing
    }
  }
});

test.serial("E2E: Pepr Init", async t => {
  try {
    execSync("TEST_MODE=true pepr init", { stdio: "inherit" });
    t.pass();
  } catch (e) {
    t.fail(e.message);
  }
});

test.serial("E2E: Pepr Build", async t => {
  try {
    execSync("pepr build", { cwd: testDir, stdio: "inherit" });
    // check if the file exists
    await fs.access(path.resolve(testDir, "dist", "zarf.yaml"));
    await fs.access(path.resolve(testDir, "dist", "pepr-module-static-test.yaml"));

    t.pass();
  } catch (e) {
    t.fail(e.message);
  }
});

test.serial("E2E: Pepr Deploy", async t => {
  try {
    // Deploy the module
    execSync("pepr deploy -i pepr:dev --confirm", { cwd: testDir, stdio: "inherit" });

    // Wait for the deployment to be ready
    await waitForDeploymentReady("pepr-system", "pepr-static-test");

    t.log("Deployment ready");

    // Apply the sample yaml for the HelloPepr capability
    execSync("kubectl apply -f hello-pepr.samples.yaml", {
      cwd: path.resolve(testDir, "capabilities"),
      stdio: "inherit",
    });

    t.log("Sample yaml applied");

    // Wait for the namespace to be created
    const ns = await waitForNamespace("pepr-demo");

    t.log("Namespace created");

    // Check if the namespace has the correct labels and annotations
    t.deepEqual(ns.metadata.labels, {
      "keep-me": "please",
      "kubernetes.io/metadata.name": "pepr-demo",
    });
    t.is(ns.metadata.annotations["static-test.pepr.dev/hello-pepr"], "succeeded");

    t.log("Namespace validated");

    const cm1 = await waitForConfigMap("pepr-demo", "example-1");
    const cm2 = await waitForConfigMap("pepr-demo", "example-2");
    const cm3 = await waitForConfigMap("pepr-demo", "example-3");
    const cm4 = await waitForConfigMap("pepr-demo", "example-4");
    const cm5 = await waitForConfigMap("pepr-demo", "example-5");

    t.log("ConfigMaps created");

    // Validate the example-1 CM
    t.is(cm1.metadata.annotations["static-test.pepr.dev/hello-pepr"], "succeeded");
    t.is(cm1.metadata.annotations["pepr.dev"], "annotations-work-too");
    t.is(cm1.metadata.labels["pepr"], "was-here");
    t.log("Validated example-1 configmap data");

    // Validate the example-2 CM
    t.is(cm2.metadata.annotations["static-test.pepr.dev/hello-pepr"], "succeeded");
    t.is(cm2.metadata.annotations["pepr.dev"], "annotations-work-too");
    t.is(cm2.metadata.labels["pepr"], "was-here");
    t.log("Validated example-2 configmap data");

    // Validate the example-3 CM
    t.is(cm3.metadata.annotations["static-test.pepr.dev/hello-pepr"], "succeeded");
    t.is(cm3.metadata.annotations["pepr.dev"], "making-waves");
    t.deepEqual(cm3.data, { key: "ex-3-val", username: "system:admin" });
    t.log("Validated example-3 configmap data");

    // Validate the example-4 CM
    t.is(cm4.metadata.annotations["static-test.pepr.dev/hello-pepr"], "succeeded");
    t.is(cm4.metadata.labels["pepr.dev/first"], "true");
    t.is(cm4.metadata.labels["pepr.dev/second"], "true");
    t.is(cm4.metadata.labels["pepr.dev/third"], "true");
    t.log("Validated example-4 configmap data");

    // Validate the example-5 CM
    t.is(cm5.metadata.annotations["static-test.pepr.dev/hello-pepr"], "succeeded");
    t.truthy(cm5.data["chuck-says"]);
    t.log("Validated example-5 configmap data");

    // Remove the sample yaml for the HelloPepr capability
    execSync("kubectl delete -f hello-pepr.samples.yaml", {
      cwd: path.resolve(testDir, "capabilities"),
      stdio: "inherit",
    });

    t.pass();
  } catch (e) {
    t.fail(e.message);
  }
});

test.serial("E2E: Pepr Dev", async t => {
  await t.notThrowsAsync(new Promise(peprDev));
});

function peprDev(resolve, reject) {
  const cmd = spawn("pepr", ["dev", "--confirm"], { cwd: testDir });

  cmd.stdout.on("data", data => {
    // Convert buffer to string
    data = stripAnsiCodes(data.toString());
    console.log(data);

    // Check if any expected lines are found
    expectedLines = expectedLines.filter(expectedLine => {
      // Check if the expected line is found in the output, ignoring whitespace
      return !data.replace(/\s+/g, " ").includes(expectedLine);
    });

    // If all expected lines are found, resolve the promise
    if (expectedLines.length < 1) {
      cmd.kill();
      resolve();
    }
  });

  // Log stderr
  cmd.stderr.on("data", data => {
    console.error(`stderr: ${data}`);
  });

  // This command should not exit on its own
  cmd.on("close", code => {
    reject(new Error(`Command exited with code ${code}`));
  });

  // Reject on error
  cmd.on("error", error => {
    reject(error);
  });

  // Reject on timeout
  setTimeout(() => {
    console.error("Remaining expected lines:" + JSON.stringify(expectedLines, null, 2));
    cmd.kill();
    reject(new Error("Timeout: Expected lines not found"));
  }, TIMEOUT);
}

async function waitForDeploymentReady(namespace, name) {
  const deployment = await k8sApi.readNamespacedDeployment(name, namespace);
  const replicas = deployment.body.spec.replicas || 1;
  const readyReplicas = deployment.body.status.readyReplicas || 0;

  if (replicas !== readyReplicas) {
    await delay2Secs();
    return waitForDeploymentReady(namespace, name);
  }
}

async function waitForNamespace(namespace) {
  try {
    const resp = await k8sCoreApi.readNamespace(namespace);
    return resp.body;
  } catch (error) {
    await delay2Secs();
    return waitForNamespace(namespace);
  }
}

async function waitForConfigMap(namespace, name) {
  try {
    const resp = await k8sCoreApi.readNamespacedConfigMap(name, namespace);
    return resp.body;
  } catch (error) {
    await delay2Secs();
    return waitForConfigMap(namespace, name);
  }
}

function delay2Secs() {
  return new Promise(resolve => setTimeout(resolve, 2000));
}
