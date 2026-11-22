---
title: "力扣 15. 三数之和"
description: "排序后枚举第一个数，剩下两个数用相向双指针在 O(n) 内找全，相同值跳过以去重，总复杂度 O(n²)。"
category: "practice"
tags: ["opposite-two-pointers"]
published: "2026-11-23"
problem:
  platform: leetcode
  number: 15
  url: "https://leetcode.cn/problems/3sum/"
  difficulty: medium
  exam: false
related: []
---

## 题意

找出整数数组中所有和为 0 的三元组。三个数必须来自不同位置，数值可以相同，但答案中不能出现重复的三元组。

## 思路

### 暴力解法

三层 for 循环，遍历所有三元组组合形式，O(n^3).

### 优化

不是所有组合都需要被遍历的，当数组为从小到大排列时，若 a 已被选定，设 a 后下一位数为 b，数组最后一位为 c，则存在 3 种情况：

1. a+b+c < 0：需要增大，b 右移

2. a+b+c > 0：需要减小，c 左移

3. a+b+c = 0：记录这个组合

此时时间复杂度被优化为了 O(n^2)

### 剪枝

固定 a 之后，先用两个极端组合判断这一轮还要不要做双指针：

1. a 加上紧跟它的两个数（这一轮能凑出的最小和）已经大于 0：后面的 a 只会更大，直接结束整个循环。

2. a 加上数组最后两个数（这一轮能凑出的最大和）仍小于 0：这个 a 凑不出 0，直接换下一个 a。

剪枝不改变最坏时间复杂度，但能跳过很多不可能有答案的轮次。

## 代码

```python
class Solution:
    def threeSum(self, nums: list[int]) -> list[list[int]]:
        n = len(nums)
        ret = []
        nums.sort()

        i_a = 0
        while i_a < n-2: 
            # 剪枝 1：这一轮的最小和都大于 0，后面的 a 只会更大
            if nums[i_a] + nums[i_a+1] + nums[i_a+2] > 0:
                break
            # 剪枝 2：这一轮的最大和仍小于 0，换下一个 a
            if nums[i_a] + nums[n-2] + nums[n-1] < 0:
                i_a += 1
                continue
            i_b = i_a + 1
            i_c = n - 1
            while i_b < i_c:
                if nums[i_a] + nums[i_b] + nums[i_c] < 0:
                    cur_b = nums[i_b]
                    while i_b < i_c and nums[i_b] == cur_b:
                        i_b += 1
                elif nums[i_a] + nums[i_b] + nums[i_c] > 0:
                    cur_c = nums[i_c]
                    while i_b < i_c and nums[i_c] == cur_c:
                        i_c -= 1
                else:
                    ret.append([nums[i_a], nums[i_b], nums[i_c]])
                    cur_b = nums[i_b]
                    while i_b < i_c and nums[i_b] == cur_b:
                        i_b += 1
                    cur_c = nums[i_c]
                    while i_b < i_c and nums[i_c] == cur_c:
                        i_c -= 1
            cur_a = nums[i_a]
            while i_a < n and nums[i_a] == cur_a:
                i_a += 1

        return ret
```

## 复杂度

- 时间：排序：O(nlog n) + 外层遍历 i_a：O(n) * 内层双指针：O(n) = O(n²)
- 空间：排序：Python 的 sort 是 Timsort，最坏需要 O(n) 辅助空间（不计答案数组）

## 易错点

去重：所有数字完全相同组合应当属于同一个三元组，所以 a, b, c 变更的时候都需要跳转到下一个不同的元素

三元组和等于零的情况，记录答案之后，b 和 c 都要跳过和自己相同的值，否则会记录重复答案。

## 小结

看到"在数组里找几个数，和满足某个条件"：

先排序，固定外层的数，把最后两个数交给相向双指针。

移动哪个指针，取决于"当前这个数还有没有可能在答案里"。

要求答案不重复时，在每一层都跳过相同的值。
