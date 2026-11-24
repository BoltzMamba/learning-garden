---
title: "力扣 300. 最长递增子序列"
description: "以 i 结尾定义 dp 得到 O(n²) 解；维护「每个长度的最小结尾」并二分查找，优化到 O(n log n)。"
category: "practice"
tags: ["dynamic-programming"]
published: "2026-11-25"
problem:
  platform: leetcode
  number: 300
  url: "https://leetcode.cn/problems/longest-increasing-subsequence/"
  difficulty: medium
  exam: false
related: []
---

## 题意

找到整数数组中最长严格递增子序列（可以不连续，但顺序不可变）的长度。

## 思路

### 解法一：动态规划

dp[i] 设置为当使用第 i 个数为结尾时的最长子序列长度。

遍历数组，对于数 r，找到其前面数值比这个数小但是 dp[l] 最大的数 l，dp[r] = dp[l]+1。如果找不到，则默认为 1。

最长递增子序列不一定以最后一个数结尾，所以答案是 max(dp)，而不是 dp[n−1]。

### 解法二：贪心 + 二分

用一个辅助数组 tails，tails[k] 存的是所有长度为 k+1 的递增子序列里，**最小的**结尾值。

为什么这样做是对的：

- **贪心**：长度相同的递增子序列，结尾越小，后面越容易接上新的数，所以每个长度只需要记住最小的结尾。
- **tails 严格递增**：长度为 k+1 的子序列去掉最后一个数，就是一个长度为 k、结尾更小的子序列，所以 tails[k−1] < tails[k]。有序才能二分查找。

遍历数组，对于每个数 num，找到 tails 中第一个 **≥ num** 的位置，用 num 替换它；如果不存在 ≥ num 的值，就将 num 加到 tails 尾部。

最终输出 tails 的长度即为解。注意 tails 本身通常不是一个真实的子序列：例如 [3, 4, 1] 处理完 tails 是 [1, 4]，原数组里 1 在 4 后面。但它的长度一定等于最长递增子序列的长度。

## 代码

解法一：动态规划

```python
class Solution:
    def lengthOfLIS(self, nums: list[int]) -> int:
        n = len(nums)
        dp = [1] * n
        for r in range(n):
            for l in range(r):
                if nums[r] > nums[l]:
                    new_len = dp[l] + 1
                    dp[r] = max(dp[r],new_len)
        return max(dp)
```

解法二：贪心 + 二分

```python
class Solution:
    def lengthOfLIS(self, nums: list[int]) -> int:
        tails = []
        for num in nums:
            l,r = 0,len(tails)
            while l < r:
                mid = (l+r)//2
                if tails[mid] < num:
                    l = mid + 1
                else:
                    r = mid
            if l >= len(tails):
                tails.append(num)
            else:
                tails[l] = num
        return len(tails)
```

## 复杂度

- 解法一：时间 O(n²)，空间 O(n)。
- 解法二：时间 O(n log n)，n 个数各做一次二分查找；空间 O(n)。

## 易错点

1. 一开始用动态规划的时候，将 dp[i] 设置为了前 i 个数中的最长子序列长度，但这样无法构建转移方程：这个状态不记录子序列以哪个数结尾，所以判断不了 nums[i] 能不能接在后面。改成以第 i 个数结尾，最后一个数就固定了，转移时只要比较 nums[l] < nums[r]。

2. 二分查找的区间是左闭右开 [l, r)，r 初始为 len(tails)，所以结果可以等于 len(tails)，表示要追加到末尾。

3. 循环结束时 l 是第一个满足 tails[l] ≥ num 的位置（相当于 bisect_left）。如果把条件写成 tails[mid] <= num，找到的就是第一个 > num 的位置（相当于 bisect_right），相等的数会被追加，严格递增就错了。例如 [2, 2] 会得到 2，正确答案是 1。

## 小结

- 子序列问题，先想「以 i 结尾」的状态定义，这样最后一个数是确定的，转移才写得出来。
- 本题 n ≤ 2500，O(n²) 能过；题目进阶要求 O(n log n)，就用解法二。
