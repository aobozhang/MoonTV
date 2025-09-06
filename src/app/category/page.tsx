/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
'use client';

import { ChevronUp } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { ApiSite, getAvailableApiSites } from '@/lib/config';
import { ApiCategory } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

function CategoryPageClient() {
  // 选择ApiSite
  const [primarySelection, setPrimarySelection] = useState<ApiSite>();
  const [secondarySelection, setSecondarySelection] = useState<ApiCategory>();
  const [primaryData, setPrimaryData] = useState<ApiSite[]>([]);
  const [secondaryData, setSecondaryData] = useState<ApiCategory[]>([]);

  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef<HTMLDivElement>(null);

  // 返回顶部按钮显示状态
  const [showBackToTop, setShowBackToTop] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const resourceId = searchParams.get('resourceId') || '';
  const categoryId = searchParams.get('categoryId') || '';

  const fetchList = async (
    primarySelection: ApiSite,
    defaultCategoryId = ''
  ) => {
    // 重置二级选择
    setSecondaryData([]);

    const params = {
      resourceId: primarySelection.key,
    };

    if (!resourceId) {
      return;
    }

    try {
      setIsLoading(true);

      const response = await fetch(
        '/api/category/list?' + new URLSearchParams(params).toString()
      );

      if (!response.ok) {
        return;
      }
      const data = await response.json();

      if (!data || !Array.isArray(data.results)) {
        return;
      }

      const finalData = [{ type_id: '', type_name: '全部' }, ...data.results];
      setSecondaryData(finalData);
      finalData.forEach((category: ApiCategory) => {
        if (String(category.type_id) === String(defaultCategoryId)) {
          setSecondarySelection(category);
        }
      });
    } catch (error) {
      throw new Error('Failed to fetch category list');
    } finally {
      setIsLoading(false);
    }
  };

  // 初始化运行
  useEffect(() => {
    // 初始化所有api site
    getAvailableApiSites().then((data) => {
      setPrimaryData(data);
      if (resourceId) {
        const selectedSite = data.find(
          (site: ApiSite) => site.key === resourceId
        );
        if (selectedSite) {
          setPrimarySelection(selectedSite);
        }
      } else {
        // 默认选择第一个apisite
        setPrimarySelection(data[0]);
      }
    });

    // 获取滚动位置的函数 - 专门针对 body 滚动
    const getScrollTop = () => {
      return document.body.scrollTop || 0;
    };

    // 使用 requestAnimationFrame 持续检测滚动位置
    let isRunning = false;
    const checkScrollPosition = () => {
      if (!isRunning) return;

      const scrollTop = getScrollTop();
      const shouldShow = scrollTop > 300;
      setShowBackToTop(shouldShow);

      requestAnimationFrame(checkScrollPosition);
    };

    // 启动持续检测
    isRunning = true;
    checkScrollPosition();

    // 监听 body 元素的滚动事件
    const handleScroll = () => {
      const scrollTop = getScrollTop();
      setShowBackToTop(scrollTop > 300);
    };

    document.body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      isRunning = false; // 停止 requestAnimationFrame 循环

      // 移除 body 滚动事件监听器
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // 初始化加载数据
  const fetchSearchResults = async (
    apiSite?: ApiSite,
    apiCategory?: ApiCategory,
    page = 1
  ) => {
    try {
      if (!apiSite) return;
      setIsLoading(true);
      const params = {
        resourceId: apiSite.key,
        q: apiCategory?.type_id || '',
        page: String(page),
      };
      const response = await fetch(
        `/api/category/detail?${new URLSearchParams(params).toString()}`
      );
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      let results = data.results;
      if (
        typeof window !== 'undefined' &&
        !(window as any).RUNTIME_CONFIG?.DISABLE_YELLOW_FILTER
      ) {
        results = results.filter((result: SearchResult) => {
          const typeName = result.type_name || '';
          return !yellowWords.some((word: string) => typeName.includes(word));
        });
      }
      setSearchResults(results);
      if (apiCategory && apiCategory.type_id === '') {
        setHasMore(false);
      }
      setShowResults(true);
    } catch (error) {
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const getCurrentHref = (rid: string, tid?: string, page?: number) => {
    let res: string;
    res = `/category?resourceId=${rid}`;
    tid ? (res = `${res}&categoryId=${tid}`) : null;
    page ? (res = `${res}&page=${page}`) : null;
    return res;
  };

  // 二级菜单点击监控
  useEffect(() => {
    if (!primarySelection || !secondarySelection) {
      return;
    }

    // 立即重置页面状态，防止基于旧状态的请求
    setSearchResults([]);
    setCurrentPage(1);
    setHasMore(true);
    setIsLoading(true);
    setIsLoadingMore(false);
    fetchSearchResults(primarySelection, secondarySelection);

    // 添加到路由
    if (secondarySelection.type_id !== categoryId) {
      router.push(
        getCurrentHref(primarySelection.key, secondarySelection.type_id)
      );
    }
  }, [secondarySelection]);

  // 一级菜单点击
  useEffect(() => {
    if (!primarySelection) {
      return;
    }

    // 添加到路由
    if (resourceId !== primarySelection.key) {
      router.push(getCurrentHref(primarySelection.key));
    }

    setIsLoading(false);
    // 立即重置页面状态，防止基于旧状态的请求
    setCurrentPage(1);
    setSearchResults([]);
    setHasMore(true);
    setIsLoadingMore(false);

    fetchList(primarySelection, categoryId);
  }, [primarySelection]);

  // 单独处理 currentPage 变化（加载更多）
  useEffect(() => {
    if (currentPage > 1) {
      if (!primarySelection && !secondarySelection) {
        return;
      }
      const fetchMoreData = async (
        apiSite?: ApiSite,
        apiCategory?: ApiCategory
      ) => {
        try {
          setIsLoadingMore(true);
          if (!apiSite) return;
          const params = {
            resourceId: apiSite.key,
            q: apiCategory?.type_id || '',
            page: String(currentPage),
          };
          const response = await fetch(
            `/api/category/detail?${new URLSearchParams(params).toString()}`
          );
          if (!response.ok) {
            setHasMore(false);
            return;
          }
          const data = await response.json();
          const results = data.results;

          if (results.length === 0) {
            setHasMore(false);
            return;
          }

          const test = searchResults.find(
            (item: SearchResult) =>
              item.id == results[0]?.id && item.source == results[0]?.source
          );

          if (test) {
            setHasMore(false);
          } else {
            setSearchResults((prev) => [...prev, ...results]);
          }
        } catch (err) {
          throw new Error('加载更多失败');
        } finally {
          setIsLoadingMore(false);
        }
      };

      fetchMoreData(primarySelection, secondarySelection);
    }
  }, [currentPage, primarySelection, secondarySelection]);

  // 设置滚动监听
  useEffect(() => {
    // 如果没有更多数据或正在加载，则不设置监听
    if (!hasMore || isLoadingMore || isLoading) {
      return;
    }

    // 确保 loadingRef 存在
    if (!loadingRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasMore &&
          !isLoadingMore &&
          !isLoading
        ) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadingRef.current);
    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, isLoadingMore, isLoading]);

  // 返回顶部功能
  const scrollToTop = () => {
    try {
      // 根据调试结果，真正的滚动容器是 document.body
      document.body.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (error) {
      // 如果平滑滚动完全失败，使用立即滚动
      document.body.scrollTop = 0;
    }
  };

  return (
    <PageLayout activePath='/category'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10 select-none'>
        <div className='space-y-3 bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm'>
          {/* 一级选择器 */}
          <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
            <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
              站点
            </span>
            <div className='overflow-x-auto flex flex-row flex-nowrap bg-gray-200/60 rounded-full p-0.5 sm:p-1 dark:bg-gray-700/60 backdrop-blur-sm'>
              {primaryData.map((item) => {
                const isActive = item.key === primarySelection?.key;
                return (
                  <div
                    key={item.key}
                    onClick={() => setPrimarySelection(item)}
                    className={`hover:bg-white/60 hover:rounded-full text-nowrap px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 active:bg-white active:rounded-sm active:border-gray-400 ${
                      isActive
                        ? 'bg-white rounded-full shadow-sm border-gray-400'
                        : ''
                    }`}
                  >
                    {item.name.indexOf('资源') > -1
                      ? item.name.slice(0, item.name.indexOf('资源'))
                      : item.name}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 二级选择器 - 只在非"全部"时显示 */}
          <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
            {secondaryData.length > 0 ? (
              <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
                分类
              </span>
            ) : null}
            <div className='overflow-x-auto flex flex-row flex-nowrap bg-gray-200/60 rounded-full p-0.5 sm:p-1 dark:bg-gray-700/60 backdrop-blur-sm'>
              {secondaryData.map((item) => {
                const isActive = item.type_id == secondarySelection?.type_id;
                return (
                  <div
                    key={item.type_id}
                    onClick={() => setSecondarySelection(item)}
                    className={`hover:bg-white/60 hover:rounded-full text-nowrap px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 active:bg-white active:rounded-full active:border-gray-400 ${
                      isActive
                        ? 'bg-white rounded-full shadow-sm border-gray-400'
                        : ''
                    }`}
                  >
                    {item.type_name}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {/* 搜索结果或搜索历史 */}
      <div className='max-w-[95%] mx-auto min-h-screen mt-12 overflow-visible'>
        {isLoading ? (
          <div className='flex justify-center items-center h-40'>
            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
          </div>
        ) : showResults ? (
          <section className='mb-12'>
            {/* 标题 */}
            <div className='mb-8 flex items-center justify-between'>
              <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                最近更新
              </h2>
            </div>
            <div
              key='search-results'
              className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'
            >
              {searchResults.map((item) => (
                <div key={`all-${item.source}-${item.id}`} className='w-full'>
                  <VideoCard
                    id={item.id}
                    title={item.title}
                    poster={item.poster}
                    episodes={item.episodes.length}
                    source={item.source}
                    source_name={item.source_name}
                    douban_id={item.douban_id}
                    year={item.year}
                    from='search'
                    type={item.episodes.length > 1 ? 'tv' : 'movie'}
                  />
                </div>
              ))}
              {searchResults.length === 0 && (
                <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
                  未找到相关结果
                </div>
              )}
            </div>
          </section>
        ) : null}

        {/* 加载更多指示器 */}
        {hasMore && !isLoading && (
          <div
            ref={(el) => {
              if (el && el.offsetParent !== null) {
                (
                  loadingRef as React.MutableRefObject<HTMLDivElement | null>
                ).current = el;
              }
            }}
            className='flex justify-center mt-12 py-8'
          >
            {isLoadingMore && (
              <div className='flex items-center gap-2'>
                <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-green-500'></div>
                <span className='text-gray-600'>加载中...</span>
              </div>
            )}
          </div>
        )}

        {/* 没有更多数据提示 */}
        {!hasMore && searchResults.length > 0 && (
          <div className='text-center text-gray-500 py-8'>已加载全部内容</div>
        )}

        {/* 空状态 */}
        {!isLoading && searchResults.length === 0 && (
          <div className='text-center text-gray-500 py-8'>暂无相关内容</div>
        )}
      </div>

      {/* 返回顶部悬浮按钮 */}
      <button
        onClick={scrollToTop}
        className={`fixed bottom-20 md:bottom-6 right-6 z-[500] w-12 h-12 bg-green-500/90 hover:bg-green-500 text-white rounded-full shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out flex items-center justify-center group ${
          showBackToTop
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        aria-label='返回顶部'
      >
        <ChevronUp className='w-6 h-6 transition-transform group-hover:scale-110' />
      </button>
    </PageLayout>
  );
}

export default function CategoryPage() {
  return (
    <Suspense>
      <CategoryPageClient />
    </Suspense>
  );
}
