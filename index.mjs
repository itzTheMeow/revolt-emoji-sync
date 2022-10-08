import fs, { read } from "fs";
import path from "path";
import { Client, Server } from "revolt.js";
import axios from "axios";
import FormData from "form-data";

const config = {
  root: "P:\\Media\\Images\\Emojis\\_lib", // folder to sync emojis from
  nameTemplate: "MeowEmojis",
  emojiRegex: /^[a-z0-9_]+$/, // https://github.com/revoltchat/backend/blob/master/crates/delta/src/util/regex.rs
};

// Put session JSON in 'session.json'.
// A bot can't be used since bots cant edit emojis.
// You can log into https://revolt.itsmeow.cat and run `JSON.parse(localStorage.session)` in devtools to get the session info.

const sessionData = JSON.parse(fs.readFileSync("session.json"));

if (!fs.existsSync("emojis.json")) fs.writeFileSync("emojis.json", `{"e":{},"s":[]}`);
const saveddata = JSON.parse(fs.readFileSync("emojis.json"));
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
  if (scanning) return;
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
    [...client.emojis.values()].filter(
      (e) => e.parent.type == "Server" && serverList.includes(e.parent.id)
    );
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
      const hasEmoji = hasEmojis.find((e) => e._id == emojiSettings.id);
      // already exists
      if (hasEmoji && emojiSettings.mod == createdAt) continue;
      else if (hasEmoji) {
        console.log(`Deleting :${f}: to be replaced.`);
        await hasEmoji.delete().catch(console.error);
      }
    }

    const png = fs.readFileSync(fullPath);
    const form = new FormData();
    form.append("file", png, `${f}.${ext.toLowerCase()}`);
    const res = await axios // this apparently has no ratelimit
      .post("https://autumn.revolt.chat/emojis", form, {
        headers: form.getHeaders(),
        data: form,
      })
      .catch(console.error);
    const fileID = res.data?.id;
    if (!fileID) {
      console.error(`No file ID found for :${f}:.`);
      continue;
    }
    // this bucket gets ratelimited to 20 every 10s - so just wait a bit over the half second limit
    // should also work for the deletions
    await new Promise((r) => setTimeout(() => r(), 750));
    const server = await (async () => {
      // searches servers to find the first one thats not full, otherwise will create one
      const get = async (i) => {
        const s = client.servers.get(serverList[i]);
        if (s) {
          if (getMyEmojis().filter((e) => e.parent.id == s._id).length >= 99)
            return await get(i + 1);
          else return s;
        } else {
          console.log(`Creating new server as the ${i} others are full.`);
          const ns = await client.servers.createServer({ name: `${config.nameTemplate}${i + 1}` });
          const form = new FormData();
          form.append("file", png, `${f}.${ext.toLowerCase()}`);
          // set the server icon to the emoji causing its creation
          axios
            .post("https://autumn.revolt.chat/icons", form, {
              headers: form.getHeaders(),
              data: form,
            })
            .then((res) =>
              ns
                .edit({
                  icon: res.data.id,
                })
                .catch(console.error)
            )
            .catch(console.error);
          ns.channels[0].delete().catch(console.error);
          serverList.push(ns._id);
          savedb();
          return ns;
        }
      };
      return await get(0);
    })();
    const newEmoji = await client.api
      .put(`/custom/emoji/${fileID}`, {
        name: f,
        parent: { type: "Server", id: server._id },
      })
      .catch((err) => {
        console.error(err);
        console.error(err.response?.data);
      });
    if (!newEmoji || !newEmoji._id) {
      console.error(`No emoji uploaded for :${f}:.`);
      continue;
    }
    emojidb[f] = {
      id: newEmoji._id,
      mod: createdAt,
      serv: server._id,
    };
    savedb();
    console.log(`Created :${f}:.`);
  }
  scanning = false;
  console.log("Done scanning emojis.");
  if (scanagain) scanEmojis(server);
}

const client = new Client({ autoReconnect: true });

client.on("ready", async () => {
  console.log(`Client is now online as ${client.user.username}.`);

  scanEmojis();
  setInterval(() => scanEmojis(), 1000 * 60 * 15); // scan every 15m too
  // sort of half works but ig itll do
  fs.watch(config.root, {}, () => scanEmojis());
});
client.on("emoji/delete", (id) => {
  client.emojis.delete(id);
});

client.useExistingSession(sessionData);
