---
title: "力扣 912. 排序数组"
description: "随机选基准的快速排序（挖坑法）：一次划分把数组分成 ≤ 基准和 ≥ 基准两段，再分治递归；期望 O(n log n)。"
category: "practice"
tags: ["divide-and-conquer"]
published: "2026-11-23"
problem:
  platform: leetcode
  number: 912
  url: "https://leetcode.cn/problems/sort-an-array/"
  difficulty: medium
  exam: true
related: []
---

## 题意

手写排序算法，将数组变为升序，不能使用任何内置函数，时间复杂度为O(nlog(n))。

## 思路

### 解法

快速排序。我用的是挖坑法，思路参考B站 [【三分钟学会快速排序】](https://www.bilibili.com/video/BV1j841197rQ)

简单地说就是随机选中一个数当基准点，将这个数移到数组最左边，然后它所在的位置被设为空。

设置两个指针，左指针从最左端开始走，右指针从最右端开始走。开始的时候，左指针指着为空的位置，右指针往左走。

如果右指针指到的数大于基准点，右指针继续左移，左指针保持不动。

如果右指针指到的数小于等于基准点，就移到空位，此时右指针的位置变成空，左指针开始右移。

如果左指针指到的数小于基准点，左指针继续右移，右指针保持不动。

如果左指针指到的数大于等于基准点，就移到空位，此时左指针的位置变成空，右指针开始左移。

左右指针相遇的位置，就是基准点在这个数组中应该在的位置。

然后再对左右数组分开递归的进行处理。

## 代码

```python
import random

class Solution:
    def sortArray(self, nums: list[int]) -> list[int]:
        n = len(nums)
        
        def quicksort(left,right):
            l = left
            r = right
            blank = l

            if l >= r:
                return

            p = random.randint(left, right)
            nums[l], nums[p] = nums[p], nums[l]

            base = nums[l]
            while l < r:
                if blank == l: # 固定 l 动 r
                    if nums[r] > base:
                        r -= 1
                    else:
                        nums[l] = nums[r]
                        blank = r
                        l += 1
                elif blank == r:
                    if nums[l] < base:
                        l += 1
                    else:
                        nums[r] = nums[l]
                        blank = l
                        r -= 1
            nums[l] = base
            quicksort(left,l-1)
            quicksort(l+1,right)

        quicksort(0,n-1)
        return nums
```

## 复杂度

- 时间：期望 O(n log n)，最坏 O(n²)。随机选基准后，最坏情况的概率极小。
- 空间：原地排序，额外空间只有递归栈，期望 O(log n)，最坏 O(n)。

## 易错点

1. 随机找基准点。否则如果数组中大部分区域已经被排过序，每次固定选最左边的数当基准，已排序的数组每次都会把最小的数选成基准。划分结果是一边 0 个、一边 n−1 个，递归 n 层，总共 时间复杂度 O(n²)。

2. nums[r] > base，nums[l] < base 不要加等号，否则会被题目里大量重复数字卡爆。

例：[2, 2, 2, 2, 2]

- 加等号时：右指针遇到的每个 2 都满足"≥ 基准"，于是一路左移，直到撞上左指针。基准停在最左边，划分成 0 个和 4 个，下一轮还是同样的情况。每轮只少一个数，一共 n 轮，O(n²)。

- 不加等号时： 遇到相等的数就停下来搬家。相等的数被轮流搬到两边，两个指针在中间（下标 2）相遇。划分成 2 个和 2 个，递归只有 log n 层。

3. 递归的时候，不要把已经排序过的数传递进去，否则会无限循环。

单独加上随机或者单独不加等号都会超时，两个加上就不超时了。

## 复盘

新凯来面试的时候让讲快排原理。

虾皮笔试也遇到了这个知识点。

## 小结

快排的核心思路就是让排序后左边的数小于pivot，右边的大于pivot。

然后分治就是将大的数组变成小的数组，从小到大用相同的方法递归的解决这个问题。
