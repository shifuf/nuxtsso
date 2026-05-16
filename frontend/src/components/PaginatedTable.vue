<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NDataTable, NPagination } from 'naive-ui';

const props = withDefaults(defineProps<{
  data: any[];
  columns: any[];
  loading?: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
  rowKey?: string;
  bordered?: boolean;
  size?: 'small' | 'medium';
  emptyText?: string;
}>(), {
  loading: false,
  pageSize: 10,
  pageSizeOptions: () => [10, 20, 50],
  rowKey: 'id',
  bordered: false,
  size: 'small',
});

const currentPage = ref(1);
const currentPageSize = ref(props.pageSize);

watch(() => props.data.length, () => { currentPage.value = 1; });

const pagedData = computed(() => {
  const start = (currentPage.value - 1) * currentPageSize.value;
  return props.data.slice(start, start + currentPageSize.value);
});

const showPagination = computed(() => props.data.length > currentPageSize.value);

const rowKeyFn = (row: any) => row?.[props.rowKey];
</script>

<template>
  <NDataTable
    :data="pagedData"
    :columns="columns"
    :loading="loading"
    :row-key="rowKeyFn"
    :bordered="bordered"
    :size="size"
  >
    <template v-for="(_, name) in $slots" #[name]="slotData">
      <slot :name="name" v-bind="slotData ?? {}" />
    </template>
  </NDataTable>
  <div v-if="showPagination" class="pagination-wrap">
    <NPagination
      v-model:page="currentPage"
      v-model:page-size="currentPageSize"
      :item-count="props.data.length"
      :page-sizes="pageSizeOptions"
      size="small"
      show-size-picker
    />
  </div>
</template>

<style scoped>
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0 4px;
}
</style>
