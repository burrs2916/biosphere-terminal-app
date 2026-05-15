export interface IconGroupDto {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface CustomIconDto {
  id: string;
  name: string;
  filePath: string;
  fileType: string;
  groupId: string;
  createdAt: number;
  updatedAt: number;
}
