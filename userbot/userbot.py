from telethon import TelegramClient, events

from telethon.tl.types import UpdateMessageReactions

api_id=1
api_hash=""

client = TelegramClient('session', api_id, api_hash)


@client.on(events.Raw())
async def handler(event):
    print(event)

client.start()
client.run_until_disconnected()
