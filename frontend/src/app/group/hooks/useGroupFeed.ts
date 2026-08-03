'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    createGroupFeedPost,
    deleteGroupFeedPost,
    getDeletedGroupFeed,
    getGroupFeed,
    permanentlyDeleteGroupFeedPost,
    restoreDeletedGroupFeedPost,
    toggleGroupPostReaction,
    updateGroupFeedPost,
    type GroupPostView,
} from '@/lib/api';

export function useGroupFeed(groupKey?: string, enabled = true) {
    const [posts, setPosts] = useState<GroupPostView[]>([]);
    const [deletedPosts, setDeletedPosts] = useState<GroupPostView[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!enabled || !groupKey) {
            setPosts([]);
            setDeletedPosts([]);
            return;
        }

        setLoading(true);
        setError('');
        const [postsRes, deletedRes] = await Promise.all([
            getGroupFeed(groupKey),
            getDeletedGroupFeed(groupKey),
        ]);

        if (!postsRes.success) {
            setError(postsRes.error || 'Failed to load feed');
            setLoading(false);
            return;
        }

        setPosts(postsRes.data?.posts || []);
        setDeletedPosts(deletedRes.success ? (deletedRes.data?.posts || []) : []);
        setLoading(false);
    }, [enabled, groupKey]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refresh();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    const createPost = useCallback(async (title: string, body: string, pinned = false) => {
        if (!groupKey) return { success: false, error: 'Missing groupKey' };
        const result = await createGroupFeedPost(title, body, groupKey, pinned);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [groupKey, refresh]);

    const updatePost = useCallback(async (postId: string, title: string, body: string, pinned: boolean) => {
        const result = await updateGroupFeedPost(postId, title, body, pinned);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [refresh]);

    const deletePost = useCallback(async (postId: string) => {
        const result = await deleteGroupFeedPost(postId);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [refresh]);

    const restorePost = useCallback(async (postId: string) => {
        const result = await restoreDeletedGroupFeedPost(postId);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [refresh]);

    const permanentlyDeletePost = useCallback(async (postId: string) => {
        const result = await permanentlyDeleteGroupFeedPost(postId);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [refresh]);

    const toggleReaction = useCallback(async (postId: string, emoji: string) => {
        if (!groupKey) return { success: false, error: 'Missing groupKey' };
        const result = await toggleGroupPostReaction(groupKey, postId, emoji);
        if (!result.success) {
            return result;
        }
        // Patch the affected post in place so the bar updates immediately
        // without rerunning the whole feed query. The server response already
        // contains the fresh aggregates + mine for this post.
        const items = result.data?.reactions || [];
        const mine = result.data?.mine || [];
        setPosts((prev) =>
            prev.map((post) =>
                post.id === postId
                    ? { ...post, reactions: { items, mine } }
                    : post,
            ),
        );
        return result;
    }, [groupKey]);

    return {
        posts,
        deletedPosts,
        loading,
        error,
        refresh,
        createPost,
        updatePost,
        deletePost,
        restorePost,
        permanentlyDeletePost,
        toggleReaction,
    };
}
