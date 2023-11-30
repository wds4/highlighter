import { writable, get as getStore, type Writable, derived } from 'svelte/store';
import { ndk, user } from "@kind0/ui-common";
import { NDKEvent, NDKList, NDKSubscriptionCacheUsage, type NDKFilter, type NDKTag, NDKKind, type NDKEventId, NDKDVMJobResult, NDKDVMRequest, NDKListKinds, type Hexpubkey } from '@nostr-dev-kit/ndk';
import type NDKSvelte from '@nostr-dev-kit/ndk-svelte';
import { NDKHighlight } from "@nostr-dev-kit/ndk";
import { persist, createLocalStorage } from "@macfja/svelte-persistent-store";
import debug from 'debug';

const d = debug('highlighter:session');

export const loadingScreen = writable<boolean>(false);

/**
 * Current user's follows
 */
export const userFollows = persist(
    writable<Set<string>>(new Set()),
    createLocalStorage(),
    'user-follows'
);

export const userSuperFollows = persist(
    writable<Set<string>>(new Set()),
    createLocalStorage(),
    'user-super-follows'
);

export const userActiveSubscriptions = persist(
    writable<Map<Hexpubkey, string>>(new Map()),
    createLocalStorage(),
    'user-active-subscriptions'
);

export const userCreatorSubscriptionPlans = derived(
    [userSuperFollows, userActiveSubscriptions],
    ([$userSuperFollows, $userActiveSubscriptions]) => {
    const plans = new Map<Hexpubkey, string>();

    for (const superFollow of $userSuperFollows) {
        if (!plans.has(superFollow)) {
            plans.set(superFollow, "Free");
        }
    }

    for (const [creator, plan] of $userActiveSubscriptions) {
        plans.set(creator, plan);
    }

    return plans;
});

/**
 * Current user app handlers
 */
type AppHandlerType = string;
type Nip33EventPointer = string;
export const userAppHandlers = persist(
    writable<Map<number, Map<AppHandlerType, Nip33EventPointer>>>(new Map()),
    createLocalStorage(),
    'user-app-handlers'
);

export const userDVMResults = writable<Map<NDKEventId, NDKDVMJobResult[]>>(new Map());
export const userDVMRequests = writable<Map<number, NDKDVMRequest[]>>(new Map());

/**
 * Current user's lists
 */
export const userLists = writable<Map<string, NDKList>>(new Map());

/**
 * Current user labels
 */
export const userLabels = writable<Set<string>>(new Set());

export const highlights = writable<Map<string, NDKHighlight>>(new Map());

/**
 * Current user's followed hashtags
 */
export const userFollowHashtags = writable<string[]>([]);

/**
 * Current user's supported people
 */
export const userSupport = writable<NDKEvent[]>([]);

/**
 * Current user's interests lists
 */
export const userInterestLists = derived(userLists, $userLists => {
    return Array.from($userLists.values())
        .filter(list => list.kind === NDKKind.InterestsList);
});

export const userShelves = derived(userLists, $userLists => {
    return Array.from($userLists.values())
        .filter(list => list.kind === NDKKind.CategorizedHighlightList);
});

/**
 * The user's extended network
 */
export const networkFollows = persist(
    writable<Set<string>>(new Set()),
    createLocalStorage(),
    'network-follows'
);

/**
 * The user's extended network lists
 */
export const networkLists = writable<Map<string, NDKList>>(new Map());

export const networkShelves = derived(networkLists, $networkLists => {
    return Array.from($networkLists.values())
        .filter(list => list.kind === NDKKind.CategorizedHighlightList);
});

/**
 * Network's supported people
 */
export const networkSupport = writable<NDKEvent[]>([]);

/**
 * Main entry point to prepare the session.
 */
export async function prepareSession(): Promise<void> {
    const $ndk = getStore(ndk);
    const $user = getStore(user);

    if (!$ndk || !$user) {
        return;
    }

    d(`running prepareSession`);

    return new Promise((resolve) => {
        const alreadyKnowFollows = getStore(userFollows).size > 0;

        fetchData(
            'user',
            $ndk,
            [$user.pubkey],
            {
                followsStore: userFollows,
                superFollowsStore: userSuperFollows,
                activeSubscriptionsStore: userActiveSubscriptions,
                appHandlers: userAppHandlers,
                supportStore: userSupport,
                waitUntilEoseToResolve: !alreadyKnowFollows,
            }
        ).then(() => {
            const $userFollows = getStore(userFollows);

            console.log(`user follows count: ${$userFollows.size}`);
            console.log(`user lists count: ${getStore(userLists).size}`);
            console.log(`user hashtags: ${Object.keys(getStore(userFollowHashtags)).length}`);

            resolve();
        });
    });
}

function isHashtagListEvent(event: NDKEvent) {
    return (
        // event.kind === 30001 &&
        event.tagValue('d') === 'hashtags'
    );
}

interface IFetchDataOptions {
    followsStore?: Writable<Set<Hexpubkey>>;
    superFollowsStore?: Writable<Set<Hexpubkey>>;
    activeSubscriptionsStore?: Writable<Map<Hexpubkey, string>>;
    supportStore?: Writable<NDKEvent[]>;
    appHandlers?: Writable<Map<number, Map<AppHandlerType, Nip33EventPointer>>>;
    listsStore?: Writable<Map<string, NDKList>>;
    listsKinds?: number[];
    extraKinds?: number[];
    followHashtagsStore?: Writable<string[]>;
    closeOnEose?: boolean;
    waitUntilEoseToResolve?: boolean;
}

/**
 * Fetches the information regarding the current user.
 * At this stage, we still don't know the user's network.
 *
 * * Protects from receiving multiple duplicated events
 * * Protects from unnecessarily calling updateFollows if the
 * * eventId is not different than something already processed
 */
async function fetchData(
    name: string,
    $ndk: NDKSvelte,
    authors: string[],
    opts: IFetchDataOptions
): Promise<void> {
    // set defaults
    opts.waitUntilEoseToResolve ??= true;
    opts.closeOnEose ??= false;
    opts.listsKinds ??= NDKListKinds;

    const mostRecentEvents: Map<string, NDKEvent> = new Map();
    const processedIdForKind: Record<number, string> = {};
    const _ = d.extend(`fetch:${name}`);

    _({waitUntilEoseToResolve: opts.waitUntilEoseToResolve});

    const processEvent = (event: NDKEvent) => {
        const dedupKey = event.deduplicationKey();
        const existingEvent = mostRecentEvents.get(dedupKey);

        if (existingEvent && event.created_at! < existingEvent.created_at!) {
            return;
        }

        mostRecentEvents.set(dedupKey, event);

        if (event.kind === 3 && opts.followsStore) {
            processContactList(event, opts.followsStore);
        } else if (event.kind === 17001 && opts.superFollowsStore) {
            processContactList(event, opts.superFollowsStore);
        } else if (event.kind === 7002 && opts.activeSubscriptionsStore) {
            processActiveSubscription(event);
        } else if (isHashtagListEvent(event) && opts.followHashtagsStore) {
            processHashtagList(event);
        } else if (event.kind === 7001) {
            processSupport(event);
        } else if (event.kind === NDKKind.AppRecommendation) {
            processAppHandler(event);
        } else if (NDKListKinds.includes(event.kind!) && opts.listsStore) {
            processList(event);
        }
    };

    const processActiveSubscription = (event: NDKEvent) => {
        opts.activeSubscriptionsStore!.update((activeSubscriptions) => {
            const untilTag = event.tagValue("until");
            const tierName = event.tagValue("tier");
            const creator = event.tagValue("creator");

            if (!untilTag || !tierName || !creator) return activeSubscriptions;

            const activeUntil = new Date(parseInt(untilTag)*1000);

            console.log(`active until: ${activeUntil}`);

            if (activeUntil > new Date()) {
                activeSubscriptions.set(creator, tierName);
            }

            return activeSubscriptions;
        });
    }

    const processSupport = (event: NDKEvent) => {
        opts.supportStore!.update((support) => {
            support.push(event);

            return support;
        });
    };

    const processAppHandler = (event: NDKEvent) => {
        opts.appHandlers!.update((appHandlers) => {
            const handlerKind = parseInt(event.tagValue("d")!);

            if (!appHandlers.has(handlerKind)) {
                appHandlers.set(handlerKind, new Map());
            }

            for (const tag of event.getMatchingTags("a")) {
                const [, eventPointer,, handlerType] = tag;

                appHandlers.get(handlerKind)!.set(handlerType, eventPointer);
            }

            return appHandlers;
        });
    };

    /**
     * Called when a newer event of kind 3 is received.
     */
    const processContactList = (event: NDKEvent, store: Writable<Set<Hexpubkey>>) => {
        if (event.id !== processedIdForKind[event.kind!]) {
            processedIdForKind[event.kind!] = event.id;
            updateFollows(event, store);
        }
    };

    const processHashtagList = (event: NDKEvent) => {
        userFollowHashtags.update((existingHashtags) => {
            for (const t of event.tags) {
                if (t[0] === 't') {
                    if (existingHashtags instanceof Array) {
                        if (!existingHashtags.includes(t[1]))
                            existingHashtags.push(t[1]);
                    // } else {
                    //     existingHashtags[t[1]] = (existingHashtags[t[1]] ?? 0) + 1;
                    }
                }
            }

            console.log(existingHashtags);

            return existingHashtags;
        });
    };

    const processList = (event: NDKEvent) => {
        const list = NDKList.from(event);

        if (!list.name || list.name.startsWith('chats/')) {
            return;
        }

        opts.listsStore!.update((lists) => {
            lists.set(list.tagId(), list);
            return lists;
        });
    };

    const updateFollows = (event: NDKEvent, store: Writable<Set<Hexpubkey>>) => {
        const follows = event.tags
            .filter((t: NDKTag) => t[0] === 'p')
            .map((t: NDKTag) => t[1]);

        // if authors has more than one, add the current data, otherwise replace
        if (authors.length > 1) {
            opts.followsStore!.update((existingFollows) => {
                follows.forEach((f) => existingFollows.add(f));
                return existingFollows;
            });
        } else
            store!.set(new Set(follows));
    };

    return new Promise((resolve) => {
        const kinds = opts.extraKinds ?? [];
        let authorPubkeyLength = 64;
        if (authors.length > 10) {
            authorPubkeyLength -= Math.floor(authors.length / 10);

            if (authorPubkeyLength < 5) authorPubkeyLength = 6;
        }

        console.log(`will request authors`, authors.length, authorPubkeyLength);

        const authorPrefixes = authors.map(f => f.slice(0, authorPubkeyLength));

        if (opts.listsStore) {
            kinds.push(...opts.listsKinds!);
        }

        const filters: NDKFilter[] = [];

        if (kinds.length > 0) {
            filters.push({ kinds, authors: authorPrefixes, limit: 10 });
        }

        if (opts.appHandlers) {
            filters.push({ authors: authorPrefixes, kinds: [NDKKind.AppRecommendation] });
        }

        if (opts.followsStore) {
            filters.push({ kinds: [3], authors: authorPrefixes });
        }

        if (opts.superFollowsStore) {
            filters.push({ kinds: [17001], authors: authorPrefixes });
        }

        if (opts.activeSubscriptionsStore) {
            filters.push({ kinds: [7002], "#p": authorPrefixes });
        }

        if (opts.followHashtagsStore) {
            filters.push({ authors: authorPrefixes, "#d": ["hashtags"] });
        }

        if (opts.supportStore) {
            filters.push({ authors: authorPrefixes, kinds: [7001 as number] });
        }

        const userDataSubscription = $ndk.subscribe(
            filters,
            {
                closeOnEose: opts.closeOnEose!,
                groupable: false,
                cacheUsage: NDKSubscriptionCacheUsage.PARALLEL,
                subId: `session:${name}`
            }
        );

        userDataSubscription.on('event', processEvent);

        userDataSubscription.on('eose', () => {
            _(`received eose`);
            console.log(`received eose`, opts.waitUntilEoseToResolve);

            // if (kind3Key) {
            //     const mostRecentKind3 = mostRecentEvents.get(kind3Key!);

            //     // Process the most recent kind 3
            //     if (mostRecentKind3!.id !== processedKind3Id) {
            //         processedKind3Id = mostRecentKind3!.id;
            //         updateFollows(mostRecentKind3!);
            //     }
            // }

            if (opts.waitUntilEoseToResolve) {
                _(`resolving`);
                console.log(`resolving`);
                resolve();
            }
        });

        if (!opts.waitUntilEoseToResolve) {
            _(`resolve without waiting for eose`);
            console.log(`resolve without waiting for eose`);
            resolve();
        }
    });
}