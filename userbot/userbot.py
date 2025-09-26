from telethon import TelegramClient, events, functions
from telethon.tl.types import (
    UpdateNewGift, Gift, GiftPremium, GiftSticker,
    PremiumGiftOption
)

api_id = 123456
api_hash = "your_api_hash"

client = TelegramClient("userbot", api_id, api_hash)

gift_options_cache = {}  # slug → (amount, currency)


async def load_gift_options():
    """
    Загружаем варианты подарков (цены и валюты)
    """
    global gift_options_cache
    try:
        result = await client(functions.payments.GetPremiumGiftOptionsRequest())
        for opt in result.options:
            if isinstance(opt, PremiumGiftOption):
                price = opt.amount / 100  # в валюте (например, USD)
                gift_options_cache[opt.slug] = (price, opt.currency)
        print(f"[+] Загружено {len(gift_options_cache)} вариантов подарков")
    except Exception as e:
        print(f"[!] Ошибка загрузки gift options: {e}")


def get_gift_price(slug: str, gift_type: str):
    if gift_type == "Gift":
        return "Бесплатный (0)"
    if slug and slug in gift_options_cache:
        amount, currency = gift_options_cache[slug]
        if currency == "XTR":  # звёзды
            return f"{int(amount)} Stars"
        else:
            return f"{amount:.2f} {currency}"
    return "(стоимость не найдена)"


def classify_sticker(gift: GiftSticker) -> str:
    """
    Определяем тип NFT подарка
    """
    if gift.unique and gift.upgraded:
        return "Уникальный (улучшенный)"
    elif gift.unique and not gift.upgraded:
        return "Уникальный (не улучшенный)"
    elif gift.rare:
        return "Редкий"
    else:
        return "Обычный"


@client.on(events.Raw)
async def handler(event):
    if isinstance(event, UpdateNewGift):
        gift = event.gift
        slug = getattr(gift, "slug", None)

        print("\n🎁 Получен новый подарок!")

        if isinstance(gift, Gift):
            print(f"- Тип: Обычный подарок")
            print(f"- ID: {gift.id}")
            print(f"- Slug: {slug}")
            print(f"- Отправитель: {gift.from_id.user_id if gift.from_id else 'аноним'}")
            print(f"- Сообщение: {gift.message or '—'}")
            print(f"- Стоимость: {get_gift_price(slug, 'Gift')}")

        elif isinstance(gift, GiftPremium):
            print(f"- Тип: Подарок Premium")
            print(f"- Месяцев: {gift.months}")
            print(f"- Slug: {slug}")
            print(f"- Отправитель: {gift.from_id.user_id if gift.from_id else 'аноним'}")
            print(f"- Сообщение: {gift.message or '—'}")
            print(f"- Стоимость: {get_gift_price(slug, 'GiftPremium')}")

        elif isinstance(gift, GiftSticker):
            category = classify_sticker(gift)
            print(f"- Тип: NFT-подарок ({category})")
            print(f"- ID: {gift.id}")
            print(f"- Slug: {slug}")
            print(f"- Уникальный: {'Да' if gift.unique else 'Нет'}")
            print(f"- Улучшенный: {'Да' if gift.upgraded else 'Нет'}")
            print(f"- Редкий: {'Да' if gift.rare else 'Нет'}")
            print(f"- Отправитель: {gift.from_id.user_id if gift.from_id else 'аноним'}")
            print(f"- Сообщение: {gift.message or '—'}")
            print(f"- Стоимость: {get_gift_price(slug, 'GiftSticker')}")

        else:
            print(f"- Неизвестный тип подарка: {type(gift)}")
            print(f"- Slug: {slug}")
            print(f"- Стоимость: {get_gift_price(slug, 'Other')}")


async def main():
    await load_gift_options()
    print("Userbot запущен. Ждём подарков...")
    await client.run_until_disconnected()


with client:
    client.loop.run_until_complete(main())
