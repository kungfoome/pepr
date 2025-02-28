// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Pepr Authors

import { execSync } from "child_process";
import { resolve } from "path";
import prompts from "prompts";
import Log from "../../../src/lib/logger";
import { RootCmd } from "../root";
import {
  genPeprTS,
  genPkgJSON,
  gitIgnore,
  helloPeprTS,
  prettierRC,
  readme,
  samplesYaml,
  snippet,
  tsConfig,
} from "./templates";
import { createDir, sanitizeName, write } from "./utils";
import { confirm, walkthrough } from "./walkthrough";

export default function (program: RootCmd) {
  program
    .command("init")
    .description("Initialize a new Pepr Module")
    // skip auto npm install and git init
    .option("--skip-post-init", "Skip npm install, git init and VSCode launch")
    .action(async opts => {
      let pkgOverride = "";

      // Overrides for testing. @todo: don't be so gross with Node CLI testing
      if (process.env.TEST_MODE === "true") {
        prompts.inject(["pepr-test-module", "A test module for Pepr", "ignore", "y"]);
        pkgOverride = "file:../";
      }

      const response = await walkthrough();
      const dirName = sanitizeName(response.name);
      const packageJSON = genPkgJSON(response, pkgOverride);
      const peprTS = genPeprTS();

      const confirmed = await confirm(dirName, packageJSON, peprTS.path);

      if (confirmed) {
        console.log("Creating new Pepr module...");

        try {
          await createDir(dirName);
          await createDir(resolve(dirName, ".vscode"));
          await createDir(resolve(dirName, "capabilities"));

          await write(resolve(dirName, gitIgnore.path), gitIgnore.data);
          await write(resolve(dirName, prettierRC.path), prettierRC.data);
          await write(resolve(dirName, packageJSON.path), packageJSON.data);
          await write(resolve(dirName, readme.path), readme.data);
          await write(resolve(dirName, tsConfig.path), tsConfig.data);
          await write(resolve(dirName, peprTS.path), peprTS.data);
          await write(resolve(dirName, ".vscode", snippet.path), snippet.data);
          await write(resolve(dirName, "capabilities", samplesYaml.path), samplesYaml.data);
          await write(resolve(dirName, "capabilities", helloPeprTS.path), helloPeprTS.data);

          if (!opts.skipPostInit) {
            // run npm install from the new directory
            process.chdir(dirName);
            execSync("npm install", {
              stdio: "inherit",
            });

            // setup git
            execSync("git init", {
              stdio: "inherit",
            });

            // try to open vscode
            try {
              execSync("code .", {
                stdio: "inherit",
              });
            } catch (e) {
              // vscode not found, do nothing
            }
          }

          console.log(`New Pepr module created at ${dirName}`);
          console.log(`Open VSCode or your editor of choice in ${dirName} to get started!`);
        } catch (e) {
          Log.debug(e);
          Log.error(e.message);
          process.exit(1);
        }
      }
    });
}
