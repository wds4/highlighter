<script lang="ts">
	import { page } from "$app/stores";
	import MainWrapper from "$components/Page/MainWrapper.svelte";
    import { pageHeader, pageSidebar } from "$stores/layout";
	import { getDefaultRelaySet } from "$utils/ndk";
	import { ndk } from "@kind0/ui-common";
	import { NDKKind } from "@nostr-dev-kit/ndk";
    import Chat from "$components/PageSidebar/Chat.svelte";
	import { onDestroy } from "svelte";

    $pageHeader = { title: "Community" };
    $pageSidebar = {
        component: Chat,
        props: {
        }
    }

    onDestroy(() => {
        $pageHeader = null;
        $pageSidebar = null;
    });

    // const relaySet = getDefaultRelaySet();
    // const chatGroups = $ndk.storeSubscribe(
    //     { kinds: [NDKKind.GroupChat], limit: 300 },
    //     { relaySet, groupable: false, closeOnEose: true }
    // )
</script>

<MainWrapper marginClass="max-w-3xl">
    <div class="flex flex-col max-w-prose w-full">
        <h1 class="text-[80px] font-semibold ">
            Community.
        </h1>
        <h2 class="text-3xl">
            Like never before
        </h2>

        <div class="text-xl mt-4 opacity-60 font-light">
            Highlighter, built on Nostr, allows for direct communication between creators and their audience. It's a place where you can share your thoughts, ideas, and opinions with the world.
        </div>
    </div>
</MainWrapper>

<style>
    h1 {
        @apply text-white leading-tight text-[80px];
    }

    h2 {
        @apply text-neutral-500 leading-tight;
    }
</style>