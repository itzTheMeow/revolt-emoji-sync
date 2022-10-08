# revolt-emoji-sync

Syncs emojis in a server with a local folder.

Make sure you set up `session.json` first. Read comments in index.mjs

All emojis should end in `.png` and be named properly. You can not use capital letters in emoji names on Revolt.

## Using

You can edit the config, mainly to change the nameTemplate and root dir. The script uses `fs.watch` to watch for file changes in the root folder. _Subdirectories are not supported._

Your files should be named `[emoji_name].[png/gif]`. Emoji names should follow revolt specifications. (a-z, 0-9, and \_)

This tool automatically creates servers for you (theres a 99 emoji limit per server). Using the name template: `MeowEmojis` will turn out as `MeowEmojis1`, `MeowEmojis2`, etc. Empty servers WILL NOT be deleted.

This isnt really _made_ for you to mess with the emojis/servers on your own, so dont be surprised if a bug occurs. (ex. if you delete one of the servers while its running)

All errors are caught and sent to the console. Some errors (like a deleted server) are handled and shouldn't be an issue. Ratelimits should not be an issue either as the script waits 750ms for each emoji.

Any contributions are welcome!
