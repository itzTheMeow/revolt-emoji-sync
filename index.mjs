import fs from "fs";
import path from "path";
import { Client, Server } from "revolt-toolset";

const config = {
  root: "/home/pcloud/Media/Images/Emojis/_lib", // folder to sync emojis from
  nameTemplate: "MeowEmojis",
  emojiRegex: /^[a-z0-9_]+$/, // https://github.com/revoltchat/backend/blob/master/crates/delta/src/util/regex.rs
};

// Put session JSON in 'session.json'.
// A bot can't be used since bots cant edit emojis.
// You can log into https://revolt.itsmeow.cat and run `JSON.parse(localStorage.session)` in devtools to get the session info.
// You just need the `token` property.

const sessionData = JSON.parse(fs.readFileSync("session.json").toString());

if (!fs.existsSync("emojis.json")) fs.writeFileSync("emojis.json", `{"e":{},"s":[]}`);
const saveddata = JSON.parse(fs.readFileSync("emojis.json").toString());
const emojidb = saveddata.e;
const serverList = saveddata.s;
const savedb = () => fs.writeFileSync("emojis.json", JSON.stringify(saveddata));

/* Example:
{
  "e": {
    "emojiName": {
      "mod": "timestamp when the PNG was last modified",
      "id": "id of the emoji",
      "serv": "server id"
    }
  },
  "s": [array of server IDs]
}
*/

let scanning = false;
let scanagain = false;
async function scanEmojis() {
  if (scanning) return (scanagain = true);
  console.log("Scanning emojis...");
  scanning = true;
  scanagain = false;
  serverList.forEach((l) => {
    if (!client.servers.get(l)) {
      serverList.splice(serverList.indexOf(l), 1);
      savedb();
    }
  });
  const toAdd = fs.readdirSync(config.root);
  const getMyEmojis = () =>
    client.emojis.filter((e) => e.parentID && serverList.includes(e.parentID));
  const hasEmojis = getMyEmojis();
  await Promise.all(
    hasEmojis.map(async (e) => {
      if (!toAdd.find((f) => path.parse(f).name == e.name)) {
        console.log(`Deleting :${e.name}: since not in list.`);
        await e.delete().catch(console.error);
      }
    })
  );
  for (let f of toAdd) {
    const fullPath = path.join(config.root, f);
    const ext = path.extname(f);
    if (["png", "gif"].includes(ext.toLowerCase())) {
      console.error(`Error with ${f}. File not png/gif.`);
      continue;
    }
    f = path.parse(f).name;
    if (!f.match(config.emojiRegex)) {
      console.error(`Error with ${f}. Emoji name not formatted properly. (a-z,0-9,_)`);
      continue;
    }
    if (f.length < 1 || f.length > 32) {
      console.error(`Error with ${f}, emoji name too long/short.`);
      continue;
    }
    if (!fs.existsSync(fullPath)) {
      scanagain = true;
      continue;
    }
    const stat = fs.statSync(fullPath);
    const createdAt = stat.mtimeMs,
      maxSize = 500 << 10;
    if (stat.size > maxSize) {
      console.error(
        `File ${f}.png is too large. (${stat.size.toLocaleString()}>${maxSize.toLocaleString()})`
      );
      continue;
    }
    const emojiSettings = emojidb[f];
    if (emojiSettings) {
      const hasEmoji = hasEmojis.find((e) => e.id == emojiSettings.id);
      // already exists
      if (hasEmoji && emojiSettings.mod == createdAt) continue;
      else if (hasEmoji) {
        console.log(`Deleting :${f}: to be replaced.`);
        await hasEmoji.delete().catch(console.error);
      }
    }

    const png = fs.readFileSync(fullPath);
    const fileID = await client.uploadAttachment(`${f}.${ext.toLowerCase()}`, png, "emojis");
    if (!fileID) {
      console.error(`No file ID found for :${f}:.`);
      continue;
    }
    // this bucket gets ratelimited to 20 every 10s - so just wait a bit over the half second limit
    // should also work for the deletions
    await new Promise((r) => setTimeout(() => r(void 0), 750));
    /** @type {Server} */
    const server = await (async () => {
      // searches servers to find the first one thats not full, otherwise will create one
      const get = async (i) => {
        const s = client.servers.get(serverList[i]);
        if (s) {
          if (getMyEmojis().filter((e) => e.parentID == s.id).length > 99) return await get(i + 1);
          else return s;
        } else {
          console.log(`Creating new server as the ${i} others are full.`);
          const ns = await client.createServer({ name: `${config.nameTemplate}${i + 1}` });
          // set the server icon to the emoji causing its creation
          client
            .uploadAttachment(`${f}.${ext.toLowerCase()}`, png, "icons")
            .then((icon) => ns.edit({ icon }).catch(console.error))
            .catch(console.error);
          ns.channels[0].delete().catch(console.error);
          serverList.push(ns.id);
          savedb();
          return ns;
        }
      };
      return await get(0);
    })();
    const newEmoji = await server.emojis.create(fileID, f).catch((err) => {
      console.error(err);
      console.error(err.response?.data);
    });
    if (!newEmoji || !newEmoji.id) {
      console.error(`No emoji uploaded for :${f}:.`);
      continue;
    }
    emojidb[f] = {
      id: newEmoji.id,
      mod: createdAt,
      serv: server.id,
    };
    savedb();
    console.log(`Created :${f}:.`);
  }
  // wait 1sec for resync
  setTimeout(() => {
    scanning = false;
    console.log("Done scanning emojis.");
    if (scanagain) scanEmojis();
  }, 1000);
}

const client = new Client({ reconnect: true });

client.once("ready", async () => {
  console.log(`Client is online as ${client.user.username}.`);

  scanEmojis();
  setInterval(() => scanEmojis(), 1000 * 60 * 60); // scan every hour too
  // sort of half works but ig itll do
  fs.watch(config.root, {}, () => scanEmojis());
});

client.login(sessionData.token, "user");
