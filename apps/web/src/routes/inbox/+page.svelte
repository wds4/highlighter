<script lang="ts">
    import { page } from '$app/stores';
    import type { NDKEventStore } from '@nostr-dev-kit/ndk-svelte';
    import { ndk } from "@kind0/ui-common";
    import { userFollows } from "$stores/session";
    import { type NDKEvent, type NDKFilter, NDKKind } from "@nostr-dev-kit/ndk";
	import FeedEvent from "$components/Feed/FeedEvent.svelte";
	import { onDestroy, onMount } from "svelte";
	import { Tray } from 'phosphor-svelte';
    import { pageHeader, pageSidebar } from "$stores/layout";
    import InboxSidebar from "$components/PageSidebar/Inbox.svelte";
	import { mode } from '$stores/inbox-view';
	import MainWrapper from '$components/Page/MainWrapper.svelte';

    let activeFilterCount: number | undefined = undefined;
    let activeView = $userFollows;

    let selectedNip05: string | undefined = undefined;
    let selectedPubkey: string | undefined = undefined;

    $: {
        selectedNip05 = $page.url.searchParams.get("id") || undefined;
        if (selectedNip05) {
            if (selectedNip05.match(/@/)) {
                $ndk.getUserFromNip05(selectedNip05).then(user => {
                    selectedPubkey = user?.pubkey;
                })
            } else {
                selectedPubkey = selectedNip05;
            }
        } else {
            selectedPubkey = undefined;
        }
    }

    function getFilters() {
        const filters: NDKFilter[] = [];

        activeFilterCount = activeView.size;

        for (const pubkey of activeView) {
            // const plan = $userCreatorSubscriptionPlans.get(pubkey) ?? "Free";
            // filters.push({ "#h": [pubkey], "#f": [plan] });
        }

        if ($mode === "all") {
            filters.push({
                authors: Array.from($userFollows),
                kinds: [
                    NDKKind.Article,
                    NDKKind.HorizontalVideo,
                ],
                limit: 50
            })
        }

        return filters;
    }

    let events: NDKEventStore<NDKEvent> | undefined;

    onMount(async () => {
        const filters = getFilters();
        events = $ndk.storeSubscribe(
            filters,
            { groupable: false, subId: 'inbox', autoStart: false }
        )
        if (filters.length > 0) {
            events.startSubscription();
        }
    });

    $pageSidebar = {
        component: InboxSidebar,
        props: {}
    }

    onDestroy(() => {
        $pageSidebar = null;
    })

    $pageHeader = {
        title: "Inbox",
        searchBar: true
    }
</script>

<svelte:head>
    <title>Inbox</title>
</svelte:head>

<MainWrapper marginClass="max-w-3xl" paddingClass="p-6">
    <div class="
        flex-col justify-start items-start flex w-full
    ">
        {#if $userFollows.size === 0}
            <div class="w-full bg-base-200 rounded-xl min-h-[50vh] h-full flex flex-col items-center justify-center gap-6">
                <Tray size="64" class="text-base-300" />
                <div class="text-xl opacity-60">
                    You are not following anyone yet
                </div>

                <a href="/" class="text-xl">
                    Explore Highlighter creators
                </a>
            </div>
        {:else if $events?.length === 0}
            <div class="w-full bg-base-200 rounded-xl min-h-[50vh] h-full flex flex-col items-center justify-center gap-6">
                <Tray size="64" class="text-base-300" />
                <div class="text-xl opacity-60">
                    No posts to show
                </div>

                <a href="/" class="text-xl">
                    Explore Highlighter creators
                </a>
            </div>
        {:else}
            {#if events && $events}
                {#each $events as event (event.id)}
                    {#if !selectedPubkey || event.pubkey === selectedPubkey}
                        <div class="w-full item">
                            <FeedEvent {event} />
                        </div>
                    {/if}
                {/each}
            {/if}
        {/if}
    </div>
</MainWrapper>

<style lang="postcss">
    .item:not(:first-child) {
        margin-top: 1rem;
    }

    .item:not(:last-child) {
        margin-bottom: 1rem;
    }

    a span.name {
        @apply text-opacity-60;
    }

    a.active span.name {
        @apply text-opacity-100;
    }
</style>