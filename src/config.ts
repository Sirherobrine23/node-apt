import { googleDriver, oracleBucket } from "@sirherobrine23/cloud";
import { extendsFS } from "@sirherobrine23/extends";
import fs from "node:fs/promises";
import yaml from "yaml";
import path from "node:path";

export type repositorySource = {
  /**
   * Dist component
   * @default main
   */
  componentName?: string,
} & ({
  type: "http",
  url: string,
  auth?: {
    header?: {[key: string]: string},
    query?: {[key: string]: string}
  }
}|{
  type: "github",
  /**
   * Repository owner
   * @example `Sirherobrine23`
   */
  owner: string,
  /**
   * Repository name
   * @example `apt-stream`
   */
  repository: string,
  /**
   * Auth token, not required if public repository
   */
  token?: string,
} & ({
  subType: "release",
  tag?: string[],
}|{
  subType: "branch",
  branch: string,
})|{
  type: "google_driver",
  clientSecret: string,
  clientId: string,
  clientToken?: googleDriver.googleCredential,
  id?: string[],
}|{
  type: "oracle_bucket",
  path?: string[],
  authConfig: oracleBucket.oracleOptions
}|{
  /**
   * get files from Docker/OCI images
   *
   * @deprecated cannot load images current version, check latest APIs to get support
   */
  type: "docker",
  image: string,
  auth?: any,
})

export type aptStreamConfig = {
  serverConfig?: {
    /** HTTP server listen */
    portListen?: number,

    /** Run Server in cluste mode, example 8 */
    clusterCount?: number,
  },

  database: {
    drive: "mongodb",
    url: string,
    /**
     * Database name
     *
     * @default 'apt-stream'
     */
    databaseName?: string,
    /**
     * Database name
     *
     * @default 'packages'
     */
    collection?: string
  }|{
    drive: "couchdb",
    url: string,
    /**
     * Database name
     *
     * @default 'apt-stream'
     */
    databaseName?: string,
  },

  gpgSign?: {
    authPassword?: string,
    private: {path?: string, content: string},
    public: {path?: string, content: string},
  },

  repository: {
    [componentName: string]: {
      source: repositorySource[],
      aptConfig?: {}
    }
  }

}

function returnUniq(arg: (string)[]) {return Array.from(new Set(arg));}

export async function createConfig(configPath: string) {
  let ext = ".json";
  if (path.extname(configPath) === ".yaml" || path.extname(configPath) === ".yml") ext = ".yaml";
  const tmpConfig: Partial<aptStreamConfig> = {
    serverConfig: {clusterCount: 0, portListen: 0},
    database: {
      drive: "mongodb",
      url: "mongodb://localhost",
      databaseName: "apt-stram",
      collection: "packages"
    },
    repository: {}
  };
  return fs.writeFile(configPath, ext === ".json" ? JSON.stringify(tmpConfig, null, 2) : yaml.stringify(tmpConfig));
}

export async function config(configPath: string, optionsOverload?: Partial<aptStreamConfig>) {
  optionsOverload ??= {};
  if (!(await extendsFS.exists(configPath))) await createConfig(configPath);
  let tmpConfig: aptStreamConfig;
  if (configPath.endsWith(".json")) tmpConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
  else if (configPath.endsWith(".yaml")||configPath.endsWith(".yml")) tmpConfig = yaml.parse(await fs.readFile(configPath, "utf8"));
  else {
    const fileContent = await fs.readFile(configPath, "utf8");
    try {
      tmpConfig = JSON.parse(fileContent);
    } catch {
      try {
        tmpConfig = yaml.parse(fileContent);
      } catch {
        throw new TypeError("Check file is JSON or YAML file format!");
      }
    }
  }

  // Create new Object
  const newConfigObject: aptStreamConfig = {
    serverConfig: {
      portListen: optionsOverload?.serverConfig?.portListen ?? tmpConfig.serverConfig?.portListen ?? 3000,
      clusterCount: optionsOverload?.serverConfig?.clusterCount ?? tmpConfig.serverConfig?.clusterCount ?? 0,
    },
    database: optionsOverload?.database ?? tmpConfig.database,
    gpgSign: (optionsOverload?.gpgSign ?? tmpConfig.gpgSign),
    repository: {},
  };

  for (const repoName of returnUniq((Object.keys(optionsOverload?.repository ?? {}).concat(...(Object.keys(tmpConfig.repository ?? {})))))) {
    for (const data of ((optionsOverload.repository?.[repoName]?.source ?? []).concat(tmpConfig.repository[repoName]?.source)).filter(Boolean)) {
      const nName = encodeURIComponent(decodeURIComponent(repoName));
      newConfigObject.repository[nName] ??= {source: []};
      if (data.type === "http") newConfigObject.repository[nName].source.push(data);
      else if (data.type === "github") {
        if (!data.owner?.trim()) throw new TypeError("github.owner is empty");
        if (!data.repository?.trim()) throw new TypeError("github.repository is empty");
        newConfigObject.repository[nName].source.push({
          type: "github",
          owner: data.owner,
          repository: data.repository,
          token: (typeof data.token === "string" && data.token.trim()) ? data.token : null,
          componentName: (typeof data.componentName === "string" && data.componentName.trim()) ? data.componentName : null,
          ...(data.subType === "release" ? {
            subType: "release",
            tag: data.tag?.filter(Boolean)
          } : {
            subType: "branch",
            branch: data.branch
          })
        });
      } else if (data.type === "oracle_bucket") {
        if (!data.authConfig) throw new TypeError("oracleBucket.authConfig required authentication");
        else if (!data.authConfig.namespace) throw new TypeError("required oracleBucket.authConfig.namespace");
        else if (!data.authConfig.name) throw new TypeError("required oracleBucket.authConfig.name");
        else if (!data.authConfig.region) throw new TypeError("required oracleBucket.authConfig.region");
        else if (!data.authConfig.auth) throw new TypeError("required oracleBucket.authConfig.auth");

        newConfigObject.repository[nName].source.push({
          type: "oracle_bucket",
          componentName: data.componentName,
          authConfig: {
            region: data.authConfig.region,
            namespace: data.authConfig.namespace,
            name: data.authConfig.name,
            auth: data.authConfig.auth,
          },
          path: data.path,
        });
      } else if (data.type === "google_driver") {
        if (!data.clientId) throw new TypeError("required googleDriver.clientId to auth");
        else if (!data.clientSecret) throw new TypeError("required googleDriver.clientSecret to auth");
        newConfigObject.repository[nName].source.push({
          type: "google_driver",
          componentName: data.componentName,
          clientId: data.clientId,
          clientSecret: data.clientSecret,
          clientToken: data.clientToken,
          id: (data.id ?? []).map(k => k?.trim()).filter(Boolean),
        });
      } else if (data.type === "docker") console.info("Ignore the docker image (%O), current not support Docker image, require more utils", data.image);
    }
  }

  return newConfigObject;
}