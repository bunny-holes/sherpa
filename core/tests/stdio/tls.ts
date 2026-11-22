import { join } from "node:path";
import { scratchHome } from "./launch.ts";

/**
 * A certificate authority made for this run and a certificate for 127.0.0.1 it signed, with the
 * system's openssl. The core trusts the authority only when NODE_EXTRA_CA_CERTS names its file at
 * start, and the app passes no such variable (§7.1).
 */
export async function trustedCertificate(): Promise<{ ca: string; cert: string; key: string }> {
  const dir = scratchHome();
  const at = (name: string) => join(dir, name);
  await Bun.write(
    at("openssl.cnf"),
    ["[req]", "distinguished_name = dn", "[dn]"]
      .concat(["[authority]", "basicConstraints = critical,CA:TRUE"])
      .concat(["keyUsage = critical,keyCertSign,cRLSign", "[server]"])
      .concat(["subjectAltName = IP:127.0.0.1", "basicConstraints = critical,CA:FALSE"])
      .concat(["keyUsage = critical,digitalSignature,keyEncipherment"])
      .concat(["extendedKeyUsage = serverAuth", ""])
      .join("\n"),
  );
  const openssl = (...args: string[]) => {
    const made = Bun.spawnSync(["/usr/bin/openssl", ...args], { stdout: "ignore", stderr: "pipe" });
    if (made.exitCode !== 0) {
      throw new Error(`openssl ${args[0]} exited with ${made.exitCode}: ${made.stderr.toString()}`);
    }
  };
  const key = ["-newkey", "rsa:2048", "-nodes", "-config", at("openssl.cnf")];
  openssl(
    "req",
    "-x509",
    ...key,
    "-days",
    "1",
    "-subj",
    "/CN=Sherpa stdio test authority",
    "-extensions",
    "authority",
    "-keyout",
    at("ca-key.pem"),
    "-out",
    at("ca.pem"),
  );
  openssl(
    "req",
    ...key,
    "-subj",
    "/CN=127.0.0.1",
    "-keyout",
    at("key.pem"),
    "-out",
    at("server.csr"),
  );
  openssl(
    "x509",
    "-req",
    "-days",
    "1",
    "-set_serial",
    "1",
    "-in",
    at("server.csr"),
    "-CA",
    at("ca.pem"),
    "-CAkey",
    at("ca-key.pem"),
    "-extfile",
    at("openssl.cnf"),
    "-extensions",
    "server",
    "-out",
    at("cert.pem"),
  );
  return {
    ca: at("ca.pem"),
    cert: await Bun.file(at("cert.pem")).text(),
    key: await Bun.file(at("key.pem")).text(),
  };
}
