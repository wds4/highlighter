import "websocket-polyfill";
import db from "$lib/db";
import { get as getStore } from "svelte/store";
import { ndk } from "@kind0/ui-common";
import { json } from "@sveltejs/kit"
import createDebug from "debug";
import type { Session } from "../../../../app.js";
import { webln } from "@getalby/sdk";
import { NDKArticle, NDKEvent, NDKUser, NDKZap } from "@nostr-dev-kit/ndk";

const log = createDebug("fans:/api/user/create-zap-request");

type Payload = {
    event: string;
    comment?: string;
}

function getRecipient(event: NDKEvent): NDKUser {
    const $ndk = getStore(ndk)
    const pTag = event.tagValue("p");
    return $ndk.getUser({pubkey: pTag});
}

async function getBitcoinPrice() {
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
    const data = await response.json();
    return data.bitcoin.usd;
}

async function calculateAmount(event: NDKEvent): Promise<number> {
    const bitcoinPrice = await getBitcoinPrice();
    const amountTag = event.getMatchingTags("amount")[0];

    if (!amountTag) throw new Error("Amount not found");

    const value = parseInt(amountTag[1]);
    const currency = amountTag[2];

    return 10;

    if (currency === "USD") {
        return Math.floor(Number(value) / bitcoinPrice * 100_000_000); // expressed in USD in the tag
    } else if (currency === "BTC") {
        return value / 1000; // expressed in msats in the tag
    } else {
        throw new Error("Currency not supported");
    }
}

function getTierNameFromSubscriptionEvent(event: NDKEvent): string | undefined {
    const tierEventString = event.tagValue("event");
    const tierEvent = new NDKArticle(undefined, JSON.parse(tierEventString));
    return tierEvent.title;
}

function calculateValidUntil(event: NDKEvent): Date {
    const amountTag = event.getMatchingTags("amount")[0];
    const cadennce = amountTag[3];
    const now = new Date();

    if (cadennce === "monthly") {
        now.setMonth(now.getMonth() + 1);
    } else if (cadennce === "yearly") {
        now.setFullYear(now.getFullYear() + 1);
    } else if (cadennce === "quarterly") {
        now.setMonth(now.getMonth() + 3);
    } else {
        throw new Error("Cadence not supported");
    }

    return now;
}

export async function POST({request, locals}) {
    try {
        const $ndk = getStore(ndk)
        const {pubkey} = locals.session as Session;
        const payload = await request.json();
        let { event: eventData, comment } = payload as Payload;
        const event = new NDKEvent($ndk, JSON.parse(eventData));
        const recipient = getRecipient(event);
        const satsAmount = await calculateAmount(event);
        const tierName = getTierNameFromSubscriptionEvent(event);

        if (!recipient) throw new Error("Recipient not found");

        const zap = new NDKZap({
            ndk: $ndk,
            zappedEvent: event,
            zappedUser: recipient
        });
        comment ??= `Zap from getfaaans`;
        const res = await zap.generateZapRequest(satsAmount, comment);
        if (!res) throw new Error("Zap request not generated");
        const {event: zapReq, zapEndpoint} = res;
        zapReq.pubkey = pubkey;
        await zapReq.toNostrEvent();

        // save zap request to db
        const record = await db.payment.create({
            data: {
                id: zapReq.id,
                payerPubkey: pubkey,
                zapRequest: JSON.stringify(zapReq.rawEvent()),
                receiverPubkey: recipient.pubkey,
                tierName,
                zappedEvent: JSON.stringify(event.rawEvent()),
                zapEndpoint,
                satsAmount,
                validUntil: calculateValidUntil(event),
                paid: false
            }
        });

        console.log({record});

        return json({event: zapReq.rawEvent()});
    } catch (error: any) {
        console.log(error);
        log(error);
        return json(error, { status: 400 });
    }
}
