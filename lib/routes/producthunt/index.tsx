import type { Context } from 'hono';
import { renderToString } from 'hono/jsx/dom/server';

import { config } from '@/config';
import type { Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

export const route: Route = {
    path: '/:period?',
    categories: ['other'],
    example: '/producthunt/daily',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['www.producthunt.com/'],
        },
    ],
    name: 'Top Products Launching Today',
    maintainers: ['miaoyafeng', 'Fatpandac'],
    handler,
    url: 'www.producthunt.com/',
};

interface Maker {
    id: string;
    name: string;
    username: string;
}

interface TopicNode {
    node: {
        id: string;
        name: string;
    };
}

interface MediaItem {
    mediaType?: string;
    imageUuid?: string;
    metadata?: {
        platform?: string;
        videoId?: string;
    };
}

interface PostNode {
    id: string;
    name: string;
    tagline: string;
    description?: string;
    votesCount: number;
    commentsCount: number;
    createdAt: string;
    makers: Maker[];
    thumbnail?: { url: string };
    thumbnailImageUuid?: string;
    slug: string;
    product: {
        slug: string;
    };
    topics: {
        edges: TopicNode[];
    };
    media?: MediaItem[];
    user?: {
        name: string;
    };
}

interface PostEdge {
    node: PostNode;
}

interface GraphQLResponse {
    data: {
        posts: {
            edges: PostEdge[];
        };
    };
}

const GRAPHQL_URL = 'https://api.producthunt.com/v2/api/graphql';

type Period = 'daily' | 'weekly' | 'monthly';

function getDateRange(period: Period): { after: Date; before: Date } {
    const today = new Date();
    const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0));

    switch (period) {
        case 'daily':
            return {
                after: todayUTC,
                before: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 0, 0, 0, 0)),
            };
        case 'weekly':
            return {
                after: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6, 0, 0, 0, 0)),
                before: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 0, 0, 0, 0)),
            };
        case 'monthly':
            return {
                after: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, today.getUTCDate() + 1, 0, 0, 0, 0)),
                before: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 0, 0, 0, 0)),
            };
        default:
            return {
                after: todayUTC,
                before: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 0, 0, 0, 0)),
            };
    }
}

async function fetchPosts(period: Period, topN: number = 50) {
    const { after, before } = getDateRange(period);

    const query = `
        query ($after: DateTime!, $before: DateTime!, $first: Int!) {
            posts(order: RANKING, postedAfter: $after, postedBefore: $before, first: $first) {
                edges {
                    node {
                        id
                        name
                        tagline
                        description
                        votesCount
                        commentsCount
                        createdAt
                        makers {
                            id
                            name
                            username
                        }
                        thumbnail {
                            url
                        }
                        thumbnailImageUuid
                        slug
                        product {
                            slug
                        }
                        topics {
                            edges {
                                node {
                                    id
                                    name
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

    const variables = {
        after: after.toISOString(),
        before: before.toISOString(),
        first: topN,
    };

    const accessToken = config.producthunt.accessToken;
    if (!accessToken) {
        throw new Error('PRODUCTHUNT_ACCESS_TOKEN is not configured');
    }

    const response = await ofetch<GraphQLResponse>(GRAPHQL_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: {
            query,
            variables,
        },
    });

    return response.data.posts.edges.map((edge) => edge.node);
}

async function fetchPostDetail(slug: string): Promise<PostNode> {
    const query = `
        query ($slug: String!) {
            post(slug: $slug) {
                id
                name
                tagline
                description
                votesCount
                commentsCount
                createdAt
                makers {
                    id
                    name
                    username
                }
                thumbnail {
                    url
                }
                thumbnailImageUuid
                slug
                product {
                    slug
                }
                topics {
                    edges {
                        node {
                            id
                            name
                        }
                    }
                }
                media {
                    mediaType
                    imageUuid
                    metadata {
                        platform
                        videoId
                    }
                }
                user {
                    name
                }
            }
        }
    `;

    const accessToken = config.producthunt.accessToken;
    if (!accessToken) {
        throw new Error('PRODUCTHUNT_ACCESS_TOKEN is not configured');
    }

    const response = await ofetch<{ data: { post: PostNode } }>(GRAPHQL_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: {
            query,
            variables: { slug },
        },
    });

    return response.data.post;
}

async function handler(ctx: Context) {
    const period = (ctx.req.param('period') || 'daily') as Period;
    const posts = await fetchPosts(period, 50);

    const list = posts.map((item) => ({
        title: item.name,
        link: `https://www.producthunt.com/products/${item.product.slug}`,
        postSlug: item.slug,
        description: item.tagline,
        pubDate: parseDate(item.createdAt),
        image: item.thumbnailImageUuid ? `https://ph-files.imgix.net/${item.thumbnailImageUuid}` : item.thumbnail?.url,
        categories: item.topics.edges.map((topic) => topic.node.name),
    }));

    const items = await Promise.all(
        list.map((item) =>
            cache.tryGet(item.link, async () => {
                const post = await fetchPostDetail(item.postSlug);

                item.author = post.user?.name || post.makers.map((m) => m.name).join(', ');
                item.description = renderDescription({
                    tagline: post.tagline,
                    description: post.description,
                    media: post.media,
                });

                return item;
            })
        )
    );

    const titleMap: Record<Period, string> = {
        daily: 'Product Hunt Today Popular',
        weekly: 'Product Hunt Weekly Popular',
        monthly: 'Product Hunt Monthly Popular',
    };

    return {
        title: titleMap[period],
        link: 'https://www.producthunt.com/',
        item: items,
    };
}

type DescriptionProps = {
    tagline?: string;
    description?: string;
    media?: MediaItem[];
};

const renderDescription = ({ tagline, description, media }: DescriptionProps): string =>
    renderToString(
        <>
            {tagline ? <blockquote>{tagline}</blockquote> : null}
            {description ? <div>{description}</div> : null}
            {media?.map((item) => {
                if (item.mediaType === 'image' && item.imageUuid) {
                    return (
                        <>
                            <img src={`https://ph-files.imgix.net/${item.imageUuid}`} />
                            <br />
                        </>
                    );
                }

                if (item.mediaType === 'video' && item.metadata?.platform === 'youtube' && item.metadata.videoId) {
                    return (
                        <iframe
                            id="ytplayer"
                            type="text/html"
                            width="640"
                            height="360"
                            src={`https://www.youtube-nocookie.com/embed/${item.metadata.videoId}`}
                            frameborder="0"
                            allowfullscreen
                            referrerpolicy="strict-origin-when-cross-origin"
                        ></iframe>
                    );
                }

                return null;
            })}
        </>
    );
