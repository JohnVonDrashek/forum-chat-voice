package platform

import (
	"container/list"
	"sync"
	"time"
)

// SiteCache is an in-memory LRU cache for custom site files served from R2.
// Keyed by "{slug}/{path}", with TTL-based expiration and a max total size.
type SiteCache struct {
	mu      sync.Mutex
	items   map[string]*list.Element
	order   *list.List // front = least recently used
	curSize int64
	maxSize int64
	ttl     time.Duration
}

type cacheItem struct {
	key         string
	data        []byte
	contentType string
	etag        string
	added       time.Time
}

func NewSiteCache(maxSizeMB int, ttl time.Duration) *SiteCache {
	return &SiteCache{
		items:   make(map[string]*list.Element),
		order:   list.New(),
		maxSize: int64(maxSizeMB) * 1024 * 1024,
		ttl:     ttl,
	}
}

func cacheKey(slug, path string) string {
	return slug + "/" + path
}

func (c *SiteCache) Get(slug, path string) (data []byte, contentType string, etag string, ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := cacheKey(slug, path)
	elem, exists := c.items[key]
	if !exists {
		return nil, "", "", false
	}
	item, _ := elem.Value.(*cacheItem) //nolint:errcheck // cache only stores *cacheItem
	if time.Since(item.added) > c.ttl {
		c.removeLocked(key)
		return nil, "", "", false
	}
	// Move to back (most recently used) — O(1)
	c.order.MoveToBack(elem)
	return item.data, item.contentType, item.etag, true
}

func (c *SiteCache) Put(slug, path string, data []byte, contentType, etag string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := cacheKey(slug, path)
	size := int64(len(data))

	// Don't cache files larger than 1MB individually
	if size > 1<<20 {
		return
	}

	// Remove old entry if exists
	if _, exists := c.items[key]; exists {
		c.removeLocked(key)
	}

	// Evict LRU entries until we have space
	for c.curSize+size > c.maxSize && c.order.Len() > 0 {
		front := c.order.Front()
		frontItem, _ := front.Value.(*cacheItem) //nolint:errcheck // cache only stores *cacheItem
		c.removeLocked(frontItem.key)
	}

	item := &cacheItem{
		key:         key,
		data:        data,
		contentType: contentType,
		etag:        etag,
		added:       time.Now(),
	}
	elem := c.order.PushBack(item)
	c.items[key] = elem
	c.curSize += size
}

func (c *SiteCache) Invalidate(slug, path string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.removeLocked(cacheKey(slug, path))
}

func (c *SiteCache) removeLocked(key string) {
	elem, exists := c.items[key]
	if !exists {
		return
	}
	item, _ := elem.Value.(*cacheItem) //nolint:errcheck // cache only stores *cacheItem
	c.curSize -= int64(len(item.data))
	c.order.Remove(elem)
	delete(c.items, key)
}
